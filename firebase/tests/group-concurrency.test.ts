import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Acceptance tests 2 and 11, against the real Firestore transaction.
 *
 * Security Rules cannot express "only one student gets the last seat" - that
 * is what the transaction is for, and the only honest way to check it is to
 * have several students reach for the same seat at the same moment.
 *
 * Runs through the Admin SDK against the emulator, so it exercises the same
 * code the route handler calls.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const { getDb } = await import('@casestudyhub/core');
const { joinGroup, listMembers, membershipId } = await import('@casestudyhub/core');
const { COLLECTIONS } = await import('@casestudyhub/shared');

const CLASS_ID = 'CONCURRENCY-A01';

function student(index: number) {
  return {
    session: { uid: `uid_${index}`, email: `sv${index}@x.edu.vn`, role: 'student' as const },
    profile: { studentId: `SV${String(index).padStart(3, '0')}`, fullName: `Student ${index}` },
  };
}

async function seedGroup(id: string, maxMembers: number, extra: Record<string, unknown> = {}) {
  await getDb()
    .collection(COLLECTIONS.groups)
    .doc(id)
    .set({
      id,
      groupCode: id,
      groupName: id,
      classId: CLASS_ID,
      maxMembers,
      memberCount: 0,
      formationMode: 'student_self_join',
      locked: false,
      status: 'forming',
      ...extra,
    });
}

async function wipe() {
  const db = getDb();
  for (const collection of [COLLECTIONS.groups, COLLECTIONS.groupMembers]) {
    const snapshot = await db.collection(collection).where('classId', '==', CLASS_ID).get();
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
  }
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('These tests must run against the emulator, never a real project.');
  }
});

beforeEach(wipe);
afterAll(wipe);

describe('two students reach for the last seat at the same moment', () => {
  it('gives it to exactly one of them', async () => {
    await seedGroup('RACE1', 1);

    const results = await Promise.allSettled(
      [1, 2].map((index) => {
        const { session, profile } = student(index);
        return joinGroup(session, CLASS_ID, 'RACE1', profile);
      }),
    );

    const succeeded = results.filter((result) => result.status === 'fulfilled');
    const failed = results.filter((result) => result.status === 'rejected');

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    const members = (await listMembers(CLASS_ID)).filter((member) => member.groupId === 'RACE1');
    expect(members).toHaveLength(1);

    const group = await getDb().collection(COLLECTIONS.groups).doc('RACE1').get();
    expect(group.get('memberCount')).toBe(1);
  });

  it('never lets six students into a group of four', async () => {
    await seedGroup('RACE4', 4);

    const results = await Promise.allSettled(
      [1, 2, 3, 4, 5, 6].map((index) => {
        const { session, profile } = student(index);
        return joinGroup(session, CLASS_ID, 'RACE4', profile);
      }),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(4);

    const group = await getDb().collection(COLLECTIONS.groups).doc('RACE4').get();
    expect(group.get('memberCount')).toBe(4);
    expect((await listMembers(CLASS_ID)).length).toBe(4);
  });
});

describe('a student belongs to at most one group per class', () => {
  it('refuses a second group even when both requests arrive together', async () => {
    await seedGroup('ONE', 6);
    await seedGroup('TWO', 6);

    const { session, profile } = student(9);
    const results = await Promise.allSettled([
      joinGroup(session, CLASS_ID, 'ONE', profile),
      joinGroup(session, CLASS_ID, 'TWO', profile),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await listMembers(CLASS_ID)).length).toBe(1);
  });

  it('refuses a second group joined one after the other', async () => {
    await seedGroup('ONE', 6);
    await seedGroup('TWO', 6);

    const { session, profile } = student(10);
    await joinGroup(session, CLASS_ID, 'ONE', profile);
    await expect(joinGroup(session, CLASS_ID, 'TWO', profile)).rejects.toThrow(/alreadyInGroup/);

    const members = await listMembers(CLASS_ID);
    expect(members).toHaveLength(1);
    expect(members[0]?.groupId).toBe('ONE');
    expect(members[0]?.id).toBe(membershipId(CLASS_ID, 'uid_10'));
  });
});

describe('a locked group', () => {
  it('takes nobody else in', async () => {
    await seedGroup('LOCKED', 6, { locked: true });
    const { session, profile } = student(11);

    await expect(joinGroup(session, CLASS_ID, 'LOCKED', profile)).rejects.toThrow(/groupLocked/);
    expect(await listMembers(CLASS_ID)).toHaveLength(0);
  });
});

describe('a group the lecturer fills', () => {
  it('refuses a student who tries to join it themselves', async () => {
    await seedGroup('ASSIGNED', 6, { formationMode: 'lecturer_assignment' });
    const { session, profile } = student(12);

    await expect(joinGroup(session, CLASS_ID, 'ASSIGNED', profile)).rejects.toThrow(
      /groupNotSelfJoin/,
    );
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Renaming a group, against the real database.
 *
 * "Group 3" is what the platform calls a group; "Nhom Marketing" is what the
 * class calls it. What this file pins down is that renaming changes only the
 * name: the group code, which every assignment and every mark was recorded
 * against, is untouched.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const { getDb, renameGroup, listGroups } = await import('@casestudyhub/core');
const { COLLECTIONS } = await import('@casestudyhub/shared');

const CLASS_ID = 'RENAME-A01';
const OTHER_CLASS_ID = 'RENAME-A02';

const admin = { uid: 'rename_admin', email: 'ad@x.edu.vn', role: 'admin' as const };
const lecturer = { uid: 'rename_lecturer', email: 'gv@x.edu.vn', role: 'lecturer' as const };

async function seedGroup(id: string, groupName: string, classId = CLASS_ID) {
  await getDb().collection(COLLECTIONS.groups).doc(id).set({
    id,
    groupCode: id,
    groupName,
    classId,
    maxMembers: 5,
    memberCount: 0,
    formationMode: 'lecturer_assignment',
    locked: false,
    status: 'forming',
  });
}

async function wipe() {
  const db = getDb();
  const jobs = [
    db.collection(COLLECTIONS.groups).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.groups).where('classId', '==', OTHER_CLASS_ID).get(),
    ...[admin.uid, lecturer.uid].map((uid) =>
      db.collection(COLLECTIONS.auditLogs).where('actorUid', '==', uid).get(),
    ),
  ];
  for (const snapshot of await Promise.all(jobs)) {
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
  }
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('These tests must run against the emulator, never a real project.');
  }
});

beforeEach(async () => {
  await wipe();
  await seedGroup('RN-G1', 'Group 1');
  await seedGroup('RN-G2', 'Group 2');
});

afterAll(wipe);

describe('renaming a group', () => {
  it('changes the name and leaves the code alone', async () => {
    await renameGroup(lecturer, CLASS_ID, 'RN-G1', 'Nhom Marketing');

    const group = (await listGroups(CLASS_ID)).find((row) => row.id === 'RN-G1');
    expect(group?.groupName).toBe('Nhom Marketing');
    expect(group?.groupCode).toBe('RN-G1');
  });

  it('trims what was typed', async () => {
    const saved = await renameGroup(admin, CLASS_ID, 'RN-G1', '  Nhom Ban le  ');
    expect(saved).toBe('Nhom Ban le');
  });

  it('records the old name beside the new one', async () => {
    await renameGroup(lecturer, CLASS_ID, 'RN-G1', 'Nhom Logistics');

    const snapshot = await getDb()
      .collection(COLLECTIONS.auditLogs)
      .where('actorUid', '==', lecturer.uid)
      .get();
    const entry = snapshot.docs
      .map((doc) => doc.data())
      .find((row) => row.action === 'group.renamed');

    expect(entry?.before).toEqual({ groupName: 'Group 1' });
    expect(entry?.after).toEqual({ groupName: 'Nhom Logistics' });
  });

  it('refuses a name another group in the class already has', async () => {
    await expect(renameGroup(lecturer, CLASS_ID, 'RN-G1', 'Group 2')).rejects.toThrow(
      /groupNameTaken/,
    );
  });

  it('ignores case and spacing when deciding that', async () => {
    await expect(renameGroup(lecturer, CLASS_ID, 'RN-G1', '  group 2 ')).rejects.toThrow(
      /groupNameTaken/,
    );
  });

  it('lets another class use the same name', async () => {
    await seedGroup('RN-G3', 'Nhom Khac', OTHER_CLASS_ID);
    await expect(renameGroup(admin, OTHER_CLASS_ID, 'RN-G3', 'Group 1')).resolves.toBe('Group 1');
  });

  it('refuses an empty name', async () => {
    await expect(renameGroup(lecturer, CLASS_ID, 'RN-G1', '   ')).rejects.toThrow(
      /groupNameInvalid/,
    );
  });

  it('refuses a group belonging to another class', async () => {
    await seedGroup('RN-G4', 'Nhom Ngoai', OTHER_CLASS_ID);
    await expect(renameGroup(lecturer, CLASS_ID, 'RN-G4', 'Nhom Moi')).rejects.toThrow(
      /groupNotFound/,
    );
  });

  it('refuses the name it already has', async () => {
    await expect(renameGroup(lecturer, CLASS_ID, 'RN-G1', 'Group 1')).rejects.toThrow(
      /nothingToUpdate/,
    );
  });
});

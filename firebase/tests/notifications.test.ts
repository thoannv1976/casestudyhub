import { afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * Notifications, against the real database.
 *
 * Two things are worth checking here and cannot be checked in isolation: that
 * a notification reaches exactly the people it is addressed to and nobody
 * else, and that the deadline warning - which is worked out at read time
 * rather than stored - appears and disappears for the right reasons.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const { getDb, notify, groupMemberUids, listNotifications, markAllRead, approveEnrollment } =
  await import('@casestudyhub/core');
const { COLLECTIONS, DEFAULT_PRESENTATION_POLICY } = await import('@casestudyhub/shared');

const CLASS_ID = 'NOTI-A01';
const GROUP_ID = 'NOTI-G1';
const ASSIGNMENT_ID = 'NOTI-A1';
const CASE_ID = 'NOTI-CS1';
const MEMBERS = ['noti_uid_1', 'noti_uid_2'];
const OUTSIDER = 'noti_outsider';

const HOUR = 3_600_000;
const policy = DEFAULT_PRESENTATION_POLICY;

async function seedClass() {
  const db = getDb();
  await db.collection(COLLECTIONS.classes).doc(CLASS_ID).set({
    id: CLASS_ID,
    classCode: 'NOTI01',
    className: 'Quan tri chien luoc',
    courseId: 'NOTI-C1',
    semester: '2026.1',
    lecturerUid: 'noti_lecturer',
    status: 'active',
  });

  for (const uid of [...MEMBERS, OUTSIDER]) {
    const inGroup = MEMBERS.includes(uid);
    await db
      .collection(COLLECTIONS.classEnrollments)
      .doc(`${CLASS_ID}__${uid}`)
      .set({
        id: `${CLASS_ID}__${uid}`,
        classId: CLASS_ID,
        studentUid: uid,
        studentId: uid.toUpperCase(),
        fullName: uid,
        email: `${uid}@university.edu.vn`,
        status: 'active',
        joinedVia: 'class_code',
      });
    await db
      .collection(COLLECTIONS.groupMembers)
      .doc(`${CLASS_ID}__${uid}`)
      .set({
        id: `${CLASS_ID}__${uid}`,
        classId: CLASS_ID,
        groupId: inGroup ? GROUP_ID : 'NOTI-G2',
        studentUid: uid,
        studentId: uid.toUpperCase(),
        fullName: uid,
        roleIds: [],
        isLeader: false,
      });
  }

  await db.collection(COLLECTIONS.caseStudies).doc(CASE_ID).set({
    id: CASE_ID,
    caseCode: 'NOTI-CS1',
    title: 'Vinamilk',
    courseId: 'NOTI-C1',
    language: 'vi',
    status: 'published',
    currentVersionId: 'v1',
  });
}

/** An assignment whose deadline is `hoursAway` from now. */
async function seedAssignment(hoursAway: number) {
  const deadline = Date.now() + hoursAway * HOUR;
  await getDb()
    .collection(COLLECTIONS.assignments)
    .doc(ASSIGNMENT_ID)
    .set({
      id: ASSIGNMENT_ID,
      classId: CLASS_ID,
      groupId: GROUP_ID,
      caseStudyId: CASE_ID,
      caseVersionId: 'v1',
      policyId: policy.id,
      policyVersion: policy.version,
      rubricVersion: policy.rubric.version,
      presentationDate: new Date(deadline + 24 * HOUR).toISOString(),
      submissionDeadline: new Date(deadline).toISOString(),
      status: 'submission_open',
    });
}

async function seedEveryDeliverable() {
  const db = getDb();
  let index = 0;
  for (const deliverable of policy.deliverables.filter((item) => item.required)) {
    index += 1;
    await db
      .collection(COLLECTIONS.submissions)
      .doc(`NOTI-S${index}`)
      .set({
        id: `NOTI-S${index}`,
        assignmentId: ASSIGNMENT_ID,
        groupId: GROUP_ID,
        deliverableId: deliverable.id,
        submittedByUid: MEMBERS[0]!,
        submittedAt: new Date().toISOString(),
        fileName: `${deliverable.id}.pdf`,
        contentType: 'application/pdf',
        sizeBytes: 100,
        storagePath: `x/${deliverable.id}.pdf`,
        versionNumber: 1,
        isLate: false,
        status: 'ready',
      });
  }
}

async function wipe() {
  const db = getDb();
  const jobs = [
    db.collection(COLLECTIONS.classes).where('id', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.classEnrollments).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.groupMembers).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.assignments).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.submissions).where('assignmentId', '==', ASSIGNMENT_ID).get(),
    db.collection(COLLECTIONS.caseStudies).where('id', '==', CASE_ID).get(),
    ...[...MEMBERS, OUTSIDER].map((uid) =>
      db.collection(COLLECTIONS.notifications).where('recipientUid', '==', uid).get(),
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
  await seedClass();
});

afterAll(wipe);

describe('who a notification reaches', () => {
  it('goes to the group it was addressed to and to nobody else', async () => {
    const recipients = await groupMemberUids(CLASS_ID, GROUP_ID);
    expect(recipients.sort()).toEqual([...MEMBERS].sort());

    await notify({
      recipientUids: recipients,
      kind: 'assignment.created',
      params: { deadline: new Date().toISOString() },
      href: `/classes/${CLASS_ID}`,
    });

    for (const uid of MEMBERS) {
      expect(await listNotifications(uid)).toHaveLength(1);
    }
    // A classmate in another group is not owed this one.
    expect(await listNotifications(OUTSIDER)).toHaveLength(0);
  });

  it('writes one row per person even when asked twice for the same one', async () => {
    const written = await notify({
      recipientUids: [MEMBERS[0]!, MEMBERS[0]!, MEMBERS[1]!],
      kind: 'grade.published',
      params: { case: 'Vinamilk' },
      href: `/classes/${CLASS_ID}`,
    });
    expect(written).toBe(2);
    expect(await listNotifications(MEMBERS[0]!)).toHaveLength(1);
  });

  it('writes nothing when there is nobody to tell', async () => {
    expect(await notify({ recipientUids: [], kind: 'grade.published', href: '/x' })).toBe(0);
  });

  it('marks only the reader\'s own as read', async () => {
    await notify({
      recipientUids: MEMBERS,
      kind: 'question.selected',
      href: `/classes/${CLASS_ID}`,
    });

    expect(await markAllRead(MEMBERS[0]!)).toBe(1);
    expect((await listNotifications(MEMBERS[0]!))[0]?.readAt).toBeTruthy();
    expect((await listNotifications(MEMBERS[1]!))[0]?.readAt).toBeUndefined();

    // Nothing left to mark the second time round.
    expect(await markAllRead(MEMBERS[0]!)).toBe(0);
  });
});

describe('what a notification says', () => {
  /**
   * The class name is read from the class, because an enrolment row does not
   * hold one. Written from memory this said "You have been admitted to ." -
   * which is why it is checked against the real document rather than a seed
   * shaped to suit.
   */
  it('names the class a student has just been admitted to', async () => {
    const db = getDb();
    const enrollmentId = `${CLASS_ID}__${OUTSIDER}`;
    await db.collection(COLLECTIONS.classEnrollments).doc(enrollmentId).update({
      status: 'pending',
    });

    await approveEnrollment(
      { uid: 'noti_lecturer', email: 'gv@x.edu.vn', role: 'lecturer' },
      CLASS_ID,
      enrollmentId,
    );

    const notifications = await listNotifications(OUTSIDER);
    const admitted = notifications.find((item) => item.kind === 'enrollment.approved');
    expect(admitted?.params.className).toBe('Quan tri chien luoc');
    expect(admitted?.href).toBe(`/classes/${CLASS_ID}`);
  });
});

describe('the deadline warning nobody wrote', () => {
  it('appears for the group that still owes something, as the deadline nears', async () => {
    await seedAssignment(6);

    const notifications = await listNotifications(MEMBERS[0]!);
    const warning = notifications.find((item) => item.kind === 'submission.dueSoon');
    expect(warning).toBeDefined();
    expect(warning?.params.case).toBe('Vinamilk');
    expect(warning?.href).toBe(`/classes/${CLASS_ID}`);
  });

  it('disappears the moment the work is handed in, with nothing to dismiss', async () => {
    await seedAssignment(6);
    expect((await listNotifications(MEMBERS[0]!)).map((item) => item.kind)).toContain(
      'submission.dueSoon',
    );

    await seedEveryDeliverable();
    expect((await listNotifications(MEMBERS[0]!)).map((item) => item.kind)).not.toContain(
      'submission.dueSoon',
    );
  });

  it('is not shown to a student in a different group of the same class', async () => {
    await seedAssignment(6);
    expect((await listNotifications(OUTSIDER)).map((item) => item.kind)).not.toContain(
      'submission.dueSoon',
    );
  });

  it('stays quiet while the deadline is still a week off', async () => {
    await seedAssignment(24 * 7);
    expect((await listNotifications(MEMBERS[0]!)).map((item) => item.kind)).not.toContain(
      'submission.dueSoon',
    );
  });

  it('cannot be marked read, because it is not a row - it goes when the work goes in', async () => {
    await seedAssignment(6);
    expect(await markAllRead(MEMBERS[0]!)).toBe(0);
    expect((await listNotifications(MEMBERS[0]!)).map((item) => item.kind)).toContain(
      'submission.dueSoon',
    );
  });
});

describe('reading order', () => {
  it('puts the unread first and the newest of those at the top', async () => {
    await notify({ recipientUids: [MEMBERS[0]!], kind: 'question.selected', href: '/a' });
    await markAllRead(MEMBERS[0]!);
    await notify({
      recipientUids: [MEMBERS[0]!],
      kind: 'grade.published',
      params: { case: 'Vinamilk' },
      href: '/b',
    });

    const notifications = await listNotifications(MEMBERS[0]!);
    expect(notifications.map((item) => item.kind)).toEqual([
      'grade.published',
      'question.selected',
    ]);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Moving a presentation that has already been set, against the real database.
 *
 * The rule worth proving here is not that a field can be written. It is that
 * the submission deadline is recomputed from the framework version the
 * assignment froze - so a class that has since moved to a different framework
 * does not silently drag work already set along with it - and that the change
 * is refused once a mark or a session has made the old date part of the
 * record.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const {
  getDb,
  createAssignment,
  getAssignment,
  reschedulePresentation,
  extendDeadline,
  clearPolicyCache,
  policyDocId,
} = await import('@casestudyhub/core');
const { COLLECTIONS, DEFAULT_PRESENTATION_POLICY } = await import('@casestudyhub/shared');

const CLASS_ID = 'SCHED-A01';
const OTHER_CLASS_ID = 'SCHED-A02';
const GROUP_ID = 'SCHED-G1';
const CASE_ID = 'SCHED-CASE1';

const policy = DEFAULT_PRESENTATION_POLICY;
const lecturer = { uid: 'sched_lecturer', email: 'gv@x.edu.vn', role: 'lecturer' as const };
const student = { uid: 'sched_student', email: 'sv@x.edu.vn', role: 'student' as const };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function inDays(days: number): string {
  return new Date(Date.now() + days * DAY).toISOString();
}

async function seed() {
  const db = getDb();

  await db
    .collection(COLLECTIONS.classes)
    .doc(CLASS_ID)
    .set({
      id: CLASS_ID,
      classCode: 'SCHED01',
      className: 'Quan tri chien luoc',
      courseId: 'SCHED-C1',
      semesterId: 'SCHED-S1',
      lecturerIds: [lecturer.uid],
      language: 'vi',
      presentationPolicyId: policy.id,
      presentationPolicyVersion: policy.version,
      joinMode: 'code',
      caseSelection: 'lecturer_assigns',
      status: 'active',
    });

  await db.collection(COLLECTIONS.groups).doc(GROUP_ID).set({
    id: GROUP_ID,
    groupCode: GROUP_ID,
    groupName: 'Nhom 1',
    classId: CLASS_ID,
    maxMembers: 5,
    memberCount: 1,
    formationMode: 'lecturer_assignment',
    locked: false,
    status: 'forming',
  });

  await db
    .collection(COLLECTIONS.groupMembers)
    .doc(`${CLASS_ID}__${student.uid}`)
    .set({
      id: `${CLASS_ID}__${student.uid}`,
      classId: CLASS_ID,
      groupId: GROUP_ID,
      studentUid: student.uid,
      studentId: 'SV001',
      fullName: 'Sinh vien A',
      roleIds: [],
      isLeader: true,
    });

  await db.collection(COLLECTIONS.caseStudies).doc(CASE_ID).set({
    id: CASE_ID,
    caseCode: 'SCHED01',
    title: 'Sephora',
    courseId: 'SCHED-C1',
    language: 'vi',
    status: 'published',
    currentVersionId: 'v1',
  });
}

async function wipe() {
  const db = getDb();
  const jobs = [
    db.collection(COLLECTIONS.assignments).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.assignments).where('classId', '==', OTHER_CLASS_ID).get(),
    db.collection(COLLECTIONS.groups).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.groupMembers).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.caseStudies).where('courseId', '==', 'SCHED-C1').get(),
    db.collection(COLLECTIONS.notifications).where('recipientUid', '==', student.uid).get(),
    db.collection(COLLECTIONS.presentationSessions).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.grades).where('groupId', '==', GROUP_ID).get(),
    // Cleared between tests: a `.find()` over a log that still holds the
    // previous test's entry finds the previous test's answer.
    db.collection(COLLECTIONS.auditLogs).where('actorUid', '==', lecturer.uid).get(),
  ];
  for (const snapshot of await Promise.all(jobs)) {
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
  }
  await db.collection(COLLECTIONS.classes).doc(CLASS_ID).delete();
  await db.collection(COLLECTIONS.policies).doc(policyDocId(policy.id, 'sched-v2')).delete();
  clearPolicyCache();
}

/** A fresh assignment, three weeks out, with the class's current framework. */
async function anAssignment(presentationDate = inDays(21)): Promise<string> {
  return createAssignment(lecturer, {
    classId: CLASS_ID,
    groupId: GROUP_ID,
    caseStudyId: CASE_ID,
    presentationDate,
  });
}

async function auditEntries(action: string) {
  const snapshot = await getDb()
    .collection(COLLECTIONS.auditLogs)
    .where('actorUid', '==', lecturer.uid)
    .get();
  return snapshot.docs.map((doc) => doc.data()).filter((entry) => entry.action === action);
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('These tests must run against the emulator, never a real project.');
  }
});

beforeEach(async () => {
  await wipe();
  await seed();
});

afterAll(wipe);

describe('moving a presentation already set', () => {
  it('writes the new date and moves the deadline with it', async () => {
    const assignmentId = await anAssignment();
    const newDate = inDays(30);

    const moved = await reschedulePresentation(
      lecturer,
      CLASS_ID,
      assignmentId,
      newDate,
      'Lop nghi le nen doi buoi thuyet trinh',
    );

    const assignment = await getAssignment(assignmentId);
    expect(assignment?.presentationDate).toBe(new Date(newDate).toISOString());
    expect(assignment?.submissionDeadline).toBe(moved.submissionDeadline);
    expect(
      Date.parse(assignment!.presentationDate) - Date.parse(assignment!.submissionDeadline),
    ).toBe(policy.submission.deadlineHoursBeforeSession * HOUR);
  });

  it('derives the deadline from the framework the assignment froze, not the class one', async () => {
    // The class moves to a framework with a different submission window after
    // the case was set. The group's own promise must not move with it.
    const assignmentId = await anAssignment();
    const db = getDb();

    await db
      .collection(COLLECTIONS.policies)
      .doc(policyDocId(policy.id, 'sched-v2'))
      .set({
        ...policy,
        version: 'sched-v2',
        submission: { ...policy.submission, deadlineHoursBeforeSession: 1 },
      });
    await db
      .collection(COLLECTIONS.classes)
      .doc(CLASS_ID)
      .update({ presentationPolicyVersion: 'sched-v2' });

    const moved = await reschedulePresentation(
      lecturer,
      CLASS_ID,
      assignmentId,
      inDays(30),
      'Doi lich theo yeu cau cua khoa',
    );

    expect(Date.parse(moved.presentationDate) - Date.parse(moved.submissionDeadline)).toBe(
      policy.submission.deadlineHoursBeforeSession * HOUR,
    );
  });

  it('tells the group, with both new dates', async () => {
    const assignmentId = await anAssignment();
    const moved = await reschedulePresentation(
      lecturer,
      CLASS_ID,
      assignmentId,
      inDays(30),
      'Giang duong ban vao ngay cu',
    );

    const snapshot = await getDb()
      .collection(COLLECTIONS.notifications)
      .where('recipientUid', '==', student.uid)
      .get();
    const told = snapshot.docs
      .map((doc) => doc.data())
      .find((entry) => entry.kind === 'assignment.rescheduled');

    expect(told).toBeDefined();
    // A key and its parameters, never a rendered sentence.
    expect(told?.params).toEqual({
      presentation: moved.presentationDate,
      deadline: moved.submissionDeadline,
    });
  });

  it('records who moved it, from what, to what, and why', async () => {
    const assignmentId = await anAssignment();
    const before = await getAssignment(assignmentId);

    await reschedulePresentation(
      lecturer,
      CLASS_ID,
      assignmentId,
      inDays(30),
      'Sinh vien di thuc te dung tuan do',
    );

    const entries = await auditEntries('assignment.rescheduled');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.before).toMatchObject({ presentationDate: before?.presentationDate });
    expect(entries[0]?.reason).toBe('Sinh vien di thuc te dung tuan do');
  });

  it('leaves work already handed in exactly as it arrived', async () => {
    // The late flag is a fact about the moment a file arrived. A decision
    // taken afterwards must not turn punctual work into late work.
    const assignmentId = await anAssignment();
    const db = getDb();
    await db.collection(COLLECTIONS.submissions).doc('SCHED-SUB1').set({
      id: 'SCHED-SUB1',
      assignmentId,
      groupId: GROUP_ID,
      deliverableId: 'slides',
      submittedByUid: student.uid,
      submittedAt: new Date().toISOString(),
      fileName: 'slides.pptx',
      storagePath: 'x/slides.pptx',
      sizeBytes: 10,
      versionNumber: 1,
      isLate: false,
      status: 'submitted',
    });

    await reschedulePresentation(
      lecturer,
      CLASS_ID,
      assignmentId,
      inDays(2),
      'Doi som hon vi lich thi',
    );

    const submission = await db.collection(COLLECTIONS.submissions).doc('SCHED-SUB1').get();
    expect(submission.get('isLate')).toBe(false);
    await submission.ref.delete();
  });
});

describe('what a reschedule refuses', () => {
  it('refuses a date in the past', async () => {
    const assignmentId = await anAssignment();
    await expect(
      reschedulePresentation(lecturer, CLASS_ID, assignmentId, inDays(-1), 'Ly do du dai'),
    ).rejects.toThrow(/presentationInPast/);
  });

  it('refuses a reason too short to mean anything later', async () => {
    const assignmentId = await anAssignment();
    await expect(
      reschedulePresentation(lecturer, CLASS_ID, assignmentId, inDays(30), 'doi'),
    ).rejects.toThrow(/reasonTooShort/);
  });

  it('refuses once a mark has been published', async () => {
    const assignmentId = await anAssignment();
    await getDb()
      .collection(COLLECTIONS.grades)
      .doc(`${assignmentId}__${student.uid}`)
      .set({
        id: `${assignmentId}__${student.uid}`,
        assignmentId,
        groupId: GROUP_ID,
        studentUid: student.uid,
        groupScore: 8,
        individualScore: 8,
        finalScore: 8,
        policyId: policy.id,
        policyVersion: policy.version,
        status: 'published',
        publishedAt: new Date().toISOString(),
        publishedByUid: lecturer.uid,
      });

    await expect(
      reschedulePresentation(lecturer, CLASS_ID, assignmentId, inDays(30), 'Doi lich sau khi cham'),
    ).rejects.toThrow(/gradeAlreadyPublished/);
  });

  it('refuses once the room has opened', async () => {
    const assignmentId = await anAssignment();
    await getDb().collection(COLLECTIONS.presentationSessions).doc('SCHED-SESS1').set({
      id: 'SCHED-SESS1',
      classId: CLASS_ID,
      assignmentId,
      groupId: GROUP_ID,
      caseStudyId: CASE_ID,
      status: 'live',
      currentRoleId: null,
      runningSinceMs: null,
      accumulatedMs: 0,
      roleMs: {},
      questionsOpen: true,
      peerReviewOpen: false,
    });

    await expect(
      reschedulePresentation(lecturer, CLASS_ID, assignmentId, inDays(30), 'Doi lich giua buoi'),
    ).rejects.toThrow(/presentationAlreadyRunning/);
  });

  it('allows it while the session is only scheduled', async () => {
    const assignmentId = await anAssignment();
    await getDb().collection(COLLECTIONS.presentationSessions).doc('SCHED-SESS2').set({
      id: 'SCHED-SESS2',
      classId: CLASS_ID,
      assignmentId,
      groupId: GROUP_ID,
      caseStudyId: CASE_ID,
      status: 'scheduled',
      currentRoleId: null,
      runningSinceMs: null,
      accumulatedMs: 0,
      roleMs: {},
      questionsOpen: false,
      peerReviewOpen: false,
    });

    await expect(
      reschedulePresentation(lecturer, CLASS_ID, assignmentId, inDays(30), 'Doi truoc khi bat dau'),
    ).resolves.toBeDefined();
  });

  it('refuses an assignment belonging to another class', async () => {
    // Permission over one class must not reach every assignment id there is.
    const assignmentId = await anAssignment();
    await expect(
      reschedulePresentation(lecturer, OTHER_CLASS_ID, assignmentId, inDays(30), 'Lop khac han'),
    ).rejects.toThrow(/assignmentNotFound/);
  });

  it('refuses the date it already has', async () => {
    const date = inDays(21);
    const assignmentId = await anAssignment(date);
    await expect(
      reschedulePresentation(lecturer, CLASS_ID, assignmentId, date, 'Khong co gi doi ca'),
    ).rejects.toThrow(/nothingToUpdate/);
  });
});

describe('extending a deadline on its own', () => {
  it('moves the deadline and leaves the presentation where it was', async () => {
    const assignmentId = await anAssignment();
    const before = await getAssignment(assignmentId);
    const later = new Date(Date.parse(before!.submissionDeadline) + 12 * HOUR).toISOString();

    await extendDeadline(lecturer, CLASS_ID, assignmentId, later, 'Mot nhom bi su co ky thuat');

    const after = await getAssignment(assignmentId);
    expect(after?.submissionDeadline).toBe(later);
    expect(after?.presentationDate).toBe(before?.presentationDate);
  });

  it('refuses an assignment belonging to another class', async () => {
    const assignmentId = await anAssignment();
    await expect(
      extendDeadline(lecturer, OTHER_CLASS_ID, assignmentId, inDays(20), 'Lop khac han'),
    ).rejects.toThrow(/assignmentNotFound/);
  });
});

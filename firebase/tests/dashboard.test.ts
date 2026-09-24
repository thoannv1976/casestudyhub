import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * The dashboard, against the real database.
 *
 * What matters here is not the layout but who sees which rows: a student is
 * shown their own group's work and nobody else's, a lecturer is shown what is
 * waiting on them, and a class somebody is not part of never appears.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const { getDb, dashboardFor, progressOfAssignments } = await import('@casestudyhub/core');
const { COLLECTIONS, DEFAULT_PRESENTATION_POLICY } = await import('@casestudyhub/shared');

const CLASS_ID = 'DASH-A01';
const OTHER_CLASS_ID = 'DASH-A02';
const GROUP_A = 'DASH-G1';
const GROUP_B = 'DASH-G2';
const CASE_ID = 'DASH-CS1';

const policy = DEFAULT_PRESENTATION_POLICY;
const required = policy.deliverables.filter((item) => item.required);
const HOUR = 3_600_000;

const lecturer = { uid: 'dash_lecturer', email: 'gv@x.edu.vn', role: 'lecturer' as const };
const studentA = { uid: 'dash_student_a', email: 'a@x.edu.vn', role: 'student' as const };
const studentB = { uid: 'dash_student_b', email: 'b@x.edu.vn', role: 'student' as const };
const outsider = { uid: 'dash_outsider', email: 'o@x.edu.vn', role: 'student' as const };

async function seedClass(classId: string, className: string, classCode: string) {
  await getDb()
    .collection(COLLECTIONS.classes)
    .doc(classId)
    .set({
      id: classId,
      classCode,
      className,
      courseId: 'DASH-C1',
      semester: '2026.1',
      lecturerUid: lecturer.uid,
      lecturerIds: [lecturer.uid],
      presentationPolicyId: policy.id,
      presentationPolicyVersion: policy.version,
      status: 'active',
    });
}

async function seedGroup(classId: string, groupId: string, groupName: string) {
  await getDb().collection(COLLECTIONS.groups).doc(groupId).set({
    id: groupId,
    groupCode: groupId,
    groupName,
    classId,
    maxMembers: 5,
    memberCount: 1,
    formationMode: 'lecturer_assignment',
    locked: false,
    status: 'forming',
  });
}

async function enrol(classId: string, uid: string, groupId: string | null) {
  const db = getDb();
  await db
    .collection(COLLECTIONS.classEnrollments)
    .doc(`${classId}__${uid}`)
    .set({
      id: `${classId}__${uid}`,
      classId,
      studentUid: uid,
      studentId: uid.toUpperCase(),
      fullName: uid,
      email: `${uid}@x.edu.vn`,
      status: 'active',
      joinedVia: 'class_code',
    });

  if (!groupId) return;
  await db
    .collection(COLLECTIONS.groupMembers)
    .doc(`${classId}__${uid}`)
    .set({
      id: `${classId}__${uid}`,
      classId,
      groupId,
      studentUid: uid,
      studentId: uid.toUpperCase(),
      fullName: uid,
      roleIds: [],
      isLeader: false,
    });
}

async function seedAssignment(
  assignmentId: string,
  classId: string,
  groupId: string,
  hoursToDeadline: number,
) {
  const deadline = Date.now() + hoursToDeadline * HOUR;
  await getDb()
    .collection(COLLECTIONS.assignments)
    .doc(assignmentId)
    .set({
      id: assignmentId,
      classId,
      groupId,
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

async function seedEverySubmission(assignmentId: string, groupId: string) {
  const db = getDb();
  let index = 0;
  for (const deliverable of required) {
    index += 1;
    await db
      .collection(COLLECTIONS.submissions)
      .doc(`${assignmentId}__S${index}`)
      .set({
        id: `${assignmentId}__S${index}`,
        assignmentId,
        groupId,
        deliverableId: deliverable.id,
        submittedByUid: studentA.uid,
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
    db.collection(COLLECTIONS.classes).where('courseId', '==', 'DASH-C1').get(),
    db.collection(COLLECTIONS.groups).where('classId', 'in', [CLASS_ID, OTHER_CLASS_ID]).get(),
    db.collection(COLLECTIONS.caseStudies).where('id', '==', CASE_ID).get(),
    ...[CLASS_ID, OTHER_CLASS_ID].flatMap((classId) => [
      db.collection(COLLECTIONS.classEnrollments).where('classId', '==', classId).get(),
      db.collection(COLLECTIONS.groupMembers).where('classId', '==', classId).get(),
      db.collection(COLLECTIONS.assignments).where('classId', '==', classId).get(),
      db.collection(COLLECTIONS.presentationSessions).where('classId', '==', classId).get(),
    ]),
    ...['DASH-AS1', 'DASH-AS2', 'DASH-AS3'].flatMap((id) => [
      db.collection(COLLECTIONS.submissions).where('assignmentId', '==', id).get(),
      db.collection(COLLECTIONS.grades).where('assignmentId', '==', id).get(),
    ]),
  ];
  for (const snapshot of await Promise.all(jobs)) {
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
  }
  for (const id of ['DASH-AS1', 'DASH-AS2', 'DASH-AS3']) {
    await db.collection(COLLECTIONS.lecturerAssessments).doc(id).delete();
  }
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('These tests must run against the emulator, never a real project.');
  }
});

beforeEach(async () => {
  await wipe();
  await seedClass(CLASS_ID, 'Quan tri chien luoc', 'DASH01');
  await seedGroup(CLASS_ID, GROUP_A, 'Nhom 1');
  await seedGroup(CLASS_ID, GROUP_B, 'Nhom 2');
  await enrol(CLASS_ID, studentA.uid, GROUP_A);
  await enrol(CLASS_ID, studentB.uid, GROUP_B);
  await getDb().collection(COLLECTIONS.caseStudies).doc(CASE_ID).set({
    id: CASE_ID,
    caseCode: 'DASH-CS1',
    title: 'Vinamilk',
    courseId: 'DASH-C1',
    language: 'vi',
    status: 'published',
  });
});

afterAll(wipe);

describe('what a student is shown', () => {
  it('shows their own group’s work and not the other group’s', async () => {
    await seedAssignment('DASH-AS1', CLASS_ID, GROUP_A, 24);
    await seedAssignment('DASH-AS2', CLASS_ID, GROUP_B, 24);

    const board = await dashboardFor(studentA);
    expect(board.outstanding.map((row) => row.assignmentId)).toEqual(['DASH-AS1']);
    expect(board.classes.map((row) => row.classId)).toEqual([CLASS_ID]);
  });

  it('stops showing work once the group has handed everything in', async () => {
    await seedAssignment('DASH-AS1', CLASS_ID, GROUP_A, 24);
    expect((await dashboardFor(studentA)).outstanding).toHaveLength(1);

    await seedEverySubmission('DASH-AS1', GROUP_A);
    expect((await dashboardFor(studentA)).outstanding).toHaveLength(0);
  });

  it('shows nothing at all to somebody in no class', async () => {
    const board = await dashboardFor(outsider);
    expect(board.classes).toHaveLength(0);
    expect(board.outstanding).toHaveLength(0);
    expect(board.live).toHaveLength(0);
  });

  it('puts the soonest deadline first, which is the one that matters', async () => {
    await seedAssignment('DASH-AS1', CLASS_ID, GROUP_A, 72);
    await seedAssignment('DASH-AS3', CLASS_ID, GROUP_A, 6);

    const board = await dashboardFor(studentA);
    expect(board.outstanding[0]?.assignmentId).toBe('DASH-AS3');
  });
});

describe('what a lecturer is shown', () => {
  it('leaves out a group that is unfinished but still within its deadline', async () => {
    await seedAssignment('DASH-AS1', CLASS_ID, GROUP_A, 24);
    expect((await dashboardFor(lecturer)).outstanding).toHaveLength(0);
  });

  it('shows a group that has gone past its deadline still owing something', async () => {
    await seedAssignment('DASH-AS1', CLASS_ID, GROUP_A, -1);

    const board = await dashboardFor(lecturer);
    expect(board.outstanding).toHaveLength(1);
    expect(board.outstanding[0]?.progress.state).toBe('overdue');
    expect(board.outstanding[0]?.groupName).toBe('Nhom 1');
  });

  it('shows a group that has handed everything in as ready to mark', async () => {
    await seedAssignment('DASH-AS1', CLASS_ID, GROUP_A, 24);
    await seedEverySubmission('DASH-AS1', GROUP_A);

    const board = await dashboardFor(lecturer);
    expect(board.outstanding[0]?.progress.state).toBe('complete');
  });

  it('never shows a class taught by somebody else', async () => {
    await seedClass(OTHER_CLASS_ID, 'Lop khac', 'DASH02');
    await getDb()
      .collection(COLLECTIONS.classes)
      .doc(OTHER_CLASS_ID)
      .update({ lecturerIds: ['someone_else'] });
    await seedAssignment('DASH-AS2', OTHER_CLASS_ID, GROUP_B, -1);

    const board = await dashboardFor(lecturer);
    expect(board.classes.map((row) => row.classId)).toEqual([CLASS_ID]);
    expect(board.outstanding).toHaveLength(0);
  });
});

describe('a session running right now', () => {
  it('reaches everyone in the class, whichever group they are in', async () => {
    await seedAssignment('DASH-AS1', CLASS_ID, GROUP_A, 24);
    await getDb().collection(COLLECTIONS.presentationSessions).doc('DASH-SS1').set({
      id: 'DASH-SS1',
      classId: CLASS_ID,
      assignmentId: 'DASH-AS1',
      groupId: GROUP_A,
      caseStudyId: CASE_ID,
      status: 'live',
      currentRoleId: 'R1',
      runningSinceMs: Date.now(),
      accumulatedMs: 0,
      roleMs: {},
      questionsOpen: true,
      peerReviewOpen: false,
    });

    for (const person of [studentA, studentB, lecturer]) {
      const board = await dashboardFor(person);
      expect(board.live.map((row) => row.sessionId)).toEqual(['DASH-SS1']);
      expect(board.live[0]?.caseTitle).toBe('Vinamilk');
    }

    // Somebody outside the class is told nothing about it.
    expect((await dashboardFor(outsider)).live).toHaveLength(0);
  });
});

describe('progress for a whole class', () => {
  it('answers for every assignment handed to it, in one call', async () => {
    await seedAssignment('DASH-AS1', CLASS_ID, GROUP_A, -1);
    await seedAssignment('DASH-AS2', CLASS_ID, GROUP_B, 24);
    await seedEverySubmission('DASH-AS2', GROUP_B);

    const assignments = [
      {
        id: 'DASH-AS1',
        policyId: policy.id,
        policyVersion: policy.version,
        submissionDeadline: new Date(Date.now() - HOUR).toISOString(),
      },
      {
        id: 'DASH-AS2',
        policyId: policy.id,
        policyVersion: policy.version,
        submissionDeadline: new Date(Date.now() + 24 * HOUR).toISOString(),
      },
    ];

    const progress = await progressOfAssignments(assignments);
    expect(progress['DASH-AS1']?.state).toBe('overdue');
    expect(progress['DASH-AS2']?.state).toBe('complete');
  });
});

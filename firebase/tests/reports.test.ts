import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Class reporting and the student portfolio, against the real database.
 *
 * The rule these tests hold is that a report is a reading of decisions
 * already made: it counts published grades and never a draft, and it never
 * writes anything back.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const { getDb, classReport, studentPortfolio } = await import('@casestudyhub/core');
const { COLLECTIONS, DEFAULT_PRESENTATION_POLICY } = await import('@casestudyhub/shared');

const CLASS_ID = 'REPORT-A01';
const ASSIGNMENT_ID = 'REPORT-A1';
const GROUP_ID = 'REPORT-G1';
const CASE_ID = 'REPORT-CS1';
const policy = DEFAULT_PRESENTATION_POLICY;

const MEMBERS = [1, 2, 3, 4].map((index) => ({
  uid: `report_uid_${index}`,
  studentId: `SV${String(index).padStart(3, '0')}`,
  fullName: `Student ${index}`,
}));

const fullScores = Object.fromEntries(
  policy.rubric.criteria.map((criterion) => [criterion.id, criterion.maxPoints]),
);

async function seedClass() {
  const db = getDb();

  await db
    .collection(COLLECTIONS.classes)
    .doc(CLASS_ID)
    .set({
      id: CLASS_ID,
      classCode: 'REPORT-A01',
      className: 'Reporting cohort',
      courseId: 'REPORT-COURSE',
      semesterId: 'REPORT-SEM',
      language: 'en',
      joinMode: 'code',
      status: 'active',
      studentCount: MEMBERS.length,
      lecturerIds: ['report_lecturer'],
    });

  await db.collection(COLLECTIONS.groups).doc(GROUP_ID).set({
    id: GROUP_ID,
    groupCode: 'G1',
    groupName: 'Group 1',
    classId: CLASS_ID,
    maxMembers: 6,
    memberCount: MEMBERS.length,
    formationMode: 'student_self_join',
    locked: false,
    status: 'active',
  });

  await db.collection(COLLECTIONS.assignments).doc(ASSIGNMENT_ID).set({
    id: ASSIGNMENT_ID,
    classId: CLASS_ID,
    groupId: GROUP_ID,
    caseStudyId: CASE_ID,
    caseVersionId: 'v1',
    policyId: policy.id,
    policyVersion: policy.version,
    rubricVersion: policy.rubric.version,
    presentationDate: new Date().toISOString(),
    submissionDeadline: new Date().toISOString(),
    status: 'completed',
  });

  for (const member of MEMBERS) {
    await db
      .collection(COLLECTIONS.groupMembers)
      .doc(`${CLASS_ID}__${member.uid}`)
      .set({
        id: `${CLASS_ID}__${member.uid}`,
        groupId: GROUP_ID,
        classId: CLASS_ID,
        studentUid: member.uid,
        studentId: member.studentId,
        fullName: member.fullName,
        roleIds: ['R1'],
        isLeader: false,
      });

    await db
      .collection(COLLECTIONS.classEnrollments)
      .doc(`${CLASS_ID}__${member.studentId}`)
      .set({
        id: `${CLASS_ID}__${member.studentId}`,
        classId: CLASS_ID,
        studentUid: member.uid,
        studentId: member.studentId,
        fullName: member.fullName,
        email: `${member.uid}@x.edu.vn`,
        status: 'active',
        joinedVia: 'class_code',
      });
  }
}

async function seedMarking(status: 'draft' | 'published') {
  await getDb()
    .collection(COLLECTIONS.lecturerAssessments)
    .doc(ASSIGNMENT_ID)
    .set({
      id: ASSIGNMENT_ID,
      assignmentId: ASSIGNMENT_ID,
      classId: CLASS_ID,
      groupId: GROUP_ID,
      caseStudyId: CASE_ID,
      criterionScores: { ...fullScores, evidence: 3 },
      groupScoreRaw: 88,
      latePenaltyWaived: false,
      individual: {},
      rubricId: policy.rubric.id,
      rubricVersion: policy.rubric.version,
      policyId: policy.id,
      policyVersion: policy.version,
      status,
      assessedByUid: 'report_lecturer',
      assessedByName: 'Tran Thi B',
      updatedAt: new Date().toISOString(),
    });
}

async function seedGrades(status: 'draft' | 'published', scores: number[]) {
  const db = getDb();
  await Promise.all(
    MEMBERS.map((member, index) =>
      db
        .collection(COLLECTIONS.grades)
        .doc(`${ASSIGNMENT_ID}__${member.uid}`)
        .set({
          id: `${ASSIGNMENT_ID}__${member.uid}`,
          assignmentId: ASSIGNMENT_ID,
          groupId: GROUP_ID,
          studentUid: member.uid,
          groupScore: 88,
          individualScore: 70,
          finalScore: scores[index] ?? 80,
          policyId: policy.id,
          policyVersion: policy.version,
          status,
        }),
    ),
  );
}

async function wipe() {
  const db = getDb();
  for (const [collection, field, value] of [
    [COLLECTIONS.groups, 'classId', CLASS_ID],
    [COLLECTIONS.groupMembers, 'classId', CLASS_ID],
    [COLLECTIONS.classEnrollments, 'classId', CLASS_ID],
    [COLLECTIONS.assignments, 'classId', CLASS_ID],
    [COLLECTIONS.lecturerAssessments, 'classId', CLASS_ID],
    [COLLECTIONS.grades, 'assignmentId', ASSIGNMENT_ID],
    [COLLECTIONS.questions, 'classId', CLASS_ID],
    [COLLECTIONS.questionResponses, 'classId', CLASS_ID],
    [COLLECTIONS.peerReviews, 'classId', CLASS_ID],
  ] as const) {
    const snapshot = await db.collection(collection).where(field, '==', value).get();
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
  }
  await db.collection(COLLECTIONS.classes).doc(CLASS_ID).delete();
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('These tests must run against the emulator, never a real project.');
  }
});

beforeEach(wipe);
afterAll(wipe);

describe('the class report', () => {
  it('counts published grades and never a draft', async () => {
    await seedClass();
    await seedMarking('published');
    await seedGrades('draft', [90, 80, 70, 60]);

    const drafted = await classReport(CLASS_ID);
    expect(drafted.distribution.count).toBe(0);

    await seedGrades('published', [90, 80, 70, 60]);
    const published = await classReport(CLASS_ID);
    expect(published.distribution.count).toBe(4);
    expect(published.distribution.mean).toBe(75);
  });

  it('warns when marking exists that nobody has published', async () => {
    await seedClass();
    await seedMarking('draft');

    const report = await classReport(CLASS_ID);
    expect(report.hasUnpublishedMarking).toBe(true);
    expect(report.markedAssignments).toBe(1);
    expect(report.publishedGrades).toBe(0);
  });

  it('names the criterion the cohort was thin on', async () => {
    await seedClass();
    await seedMarking('published');

    const report = await classReport(CLASS_ID);
    const evidence = report.criteria.find((row) => row.criterionId === 'evidence');
    const analysis = report.criteria.find((row) => row.criterionId === 'analysis');

    expect(evidence?.meanShare).toBeCloseTo(3 / 15, 6);
    expect(analysis?.meanShare).toBe(1);
  });

  it('reports CLO attainment only from criteria that claim to measure it', async () => {
    await seedClass();
    await seedMarking('published');

    const report = await classReport(CLASS_ID);
    // CLO6 comes from critique and transferDecision, both at full marks.
    expect(report.clos.find((clo) => clo.cloId === 'CLO6')?.attainment).toBe(1);
    // CLO1 includes evidence, which was 3 of 15.
    expect(report.clos.find((clo) => clo.cloId === 'CLO1')?.attainment).toBeLessThan(1);
  });

  it('names the students who took no part at all', async () => {
    await seedClass();
    await getDb().collection(COLLECTIONS.questions).doc('rq1').set({
      id: 'rq1',
      caseStudyId: CASE_ID,
      sessionId: 'REPORT-PS1',
      classId: CLASS_ID,
      groupId: GROUP_ID,
      askedByUid: MEMBERS[0]!.uid,
      askedByName: 'Student 1',
      askedByStudentId: 'SV001',
      anonymousToClass: true,
      roleId: null,
      category: 'evidence',
      text: 'Which figure supports that claim, precisely?',
      upvotes: 0,
      status: 'submitted',
      answeredByAi: false,
    });

    const report = await classReport(CLASS_ID);
    expect(report.participation.enrolled).toBe(4);
    expect(report.participation.asked).toBe(1);
    expect(report.participation.silentUids.sort()).toEqual(
      MEMBERS.slice(1)
        .map((member) => member.uid)
        .sort(),
    );
  });

  it('says nothing rather than zero for a class with no marks at all', async () => {
    await seedClass();
    const report = await classReport(CLASS_ID);

    expect(report.markedAssignments).toBe(0);
    expect(report.hasUnpublishedMarking).toBe(false);
    expect(report.clos.every((clo) => clo.count === 0)).toBe(true);
  });
});

describe('a student’s portfolio', () => {
  it('shows a mark only once it has been published', async () => {
    await seedClass();
    await seedGrades('draft', [90, 80, 70, 60]);

    const drafted = await studentPortfolio(MEMBERS[0]!.uid);
    expect(drafted.entries[0]?.finalScore).toBeNull();

    await seedGrades('published', [90, 80, 70, 60]);
    const published = await studentPortfolio(MEMBERS[0]!.uid);
    expect(published.entries[0]?.finalScore).toBe(90);
    expect(published.entries[0]?.groupName).toBe('Group 1');
  });

  it('counts contribution, not only marks', async () => {
    await seedClass();
    const db = getDb();
    await db.collection(COLLECTIONS.questions).doc('pq1').set({
      id: 'pq1',
      caseStudyId: CASE_ID,
      sessionId: 'REPORT-PS1',
      classId: CLASS_ID,
      groupId: GROUP_ID,
      askedByUid: MEMBERS[0]!.uid,
      askedByName: 'Student 1',
      askedByStudentId: 'SV001',
      anonymousToClass: true,
      roleId: null,
      category: 'evidence',
      text: 'Which figure supports that claim, precisely?',
      upvotes: 0,
      status: 'submitted',
      answeredByAi: false,
    });
    await db.collection(COLLECTIONS.questionResponses).doc('pr1').set({
      questionId: 'pq1',
      sessionId: 'REPORT-PS1',
      classId: CLASS_ID,
      groupId: GROUP_ID,
      responderUid: MEMBERS[0]!.uid,
      responderName: 'Student 1',
    });

    const portfolio = await studentPortfolio(MEMBERS[0]!.uid);
    expect(portfolio.totals.questionsAsked).toBe(1);
    expect(portfolio.totals.questionsAnsweredAloud).toBe(1);
    expect(portfolio.totals.rolesHeld).toEqual(['R1']);
  });

  it('shows a student who did nothing exactly that, rather than hiding it', async () => {
    await seedClass();

    const portfolio = await studentPortfolio(MEMBERS[3]!.uid);
    expect(portfolio.entries).toHaveLength(1);
    expect(portfolio.totals.questionsAsked).toBe(0);
    expect(portfolio.totals.peerScoresGiven).toBe(0);
    expect(portfolio.totals.publishedScores).toEqual([]);
  });

  it('is empty, not broken, for a student in no class', async () => {
    const portfolio = await studentPortfolio('nobody_at_all');
    expect(portfolio.entries).toEqual([]);
    expect(portfolio.totals.classes).toBe(0);
  });
});

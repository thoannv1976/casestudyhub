import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Marking and publishing, against the real database.
 *
 * The rule under test is not arithmetic - the grade engine has its own unit
 * tests - but what publishing means: every member of the group gets a mark or
 * none does, a published grade cannot be quietly edited, and a student sees
 * nothing at all until the lecturer decides they should.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const {
  getDb,
  saveLecturerAssessment,
  getLecturerAssessment,
  previewGrades,
  publishGrades,
  listGradesForAssignment,
  listPublishedGradesOfStudent,
} = await import('@casestudyhub/core');
const { COLLECTIONS, DEFAULT_PRESENTATION_POLICY } = await import('@casestudyhub/shared');

const CLASS_ID = 'GRADE-A01';
const ASSIGNMENT_ID = 'GRADE-A1';
const GROUP_ID = 'GRADE-G1';

const policy = DEFAULT_PRESENTATION_POLICY;
const lecturer = { uid: 'grade_lecturer', email: 'gv@x.edu.vn', role: 'lecturer' as const };

const MEMBERS = [1, 2, 3, 4].map((index) => ({
  uid: `grade_uid_${index}`,
  studentId: `SV${String(index).padStart(3, '0')}`,
  fullName: `Student ${index}`,
}));

const fullScores = Object.fromEntries(
  policy.rubric.criteria.map((criterion) => [criterion.id, criterion.maxPoints]),
);

function individualFor(score = 80) {
  return Object.fromEntries(
    MEMBERS.map((member) => [
      member.uid,
      { rawScore: score, didNotPresent: false, failedOwnRoleQuestion: false },
    ]),
  );
}

async function seedAssignment(deadlineOffsetHours = 24) {
  const presentation = Date.now() + 7 * 24 * 60 * 60 * 1000;
  await getDb()
    .collection(COLLECTIONS.assignments)
    .doc(ASSIGNMENT_ID)
    .set({
      id: ASSIGNMENT_ID,
      classId: CLASS_ID,
      groupId: GROUP_ID,
      caseStudyId: 'GRADE-CS1',
      caseVersionId: 'v1',
      policyId: policy.id,
      policyVersion: policy.version,
      rubricVersion: policy.rubric.version,
      presentationDate: new Date(presentation).toISOString(),
      submissionDeadline: new Date(presentation - deadlineOffsetHours * 3600_000).toISOString(),
      status: 'submission_open',
    });

  for (const member of MEMBERS) {
    await getDb()
      .collection(COLLECTIONS.groupMembers)
      .doc(`${CLASS_ID}__${member.uid}`)
      .set({
        id: `${CLASS_ID}__${member.uid}`,
        groupId: GROUP_ID,
        classId: CLASS_ID,
        studentUid: member.uid,
        studentId: member.studentId,
        fullName: member.fullName,
        roleIds: [],
        isLeader: false,
      });
  }
}

async function seedSubmission(isLate: boolean) {
  await getDb().collection(COLLECTIONS.submissions).doc('GRADE-S1').set({
    id: 'GRADE-S1',
    assignmentId: ASSIGNMENT_ID,
    groupId: GROUP_ID,
    deliverableId: 'slides-pdf',
    submittedByUid: MEMBERS[0]!.uid,
    submittedAt: new Date().toISOString(),
    fileName: 'slides.pdf',
    contentType: 'application/pdf',
    sizeBytes: 100,
    storagePath: 'x/slides.pdf',
    versionNumber: 1,
    isLate,
    status: 'ready',
  });
}

async function wipe() {
  const db = getDb();
  const jobs = [
    db.collection(COLLECTIONS.assignments).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.groupMembers).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.submissions).where('assignmentId', '==', ASSIGNMENT_ID).get(),
    db.collection(COLLECTIONS.grades).where('assignmentId', '==', ASSIGNMENT_ID).get(),
    db.collection(COLLECTIONS.lecturerAssessments).where('classId', '==', CLASS_ID).get(),
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

beforeEach(wipe);
afterAll(wipe);

describe('marking a group', () => {
  it('freezes the policy version the case was set under', async () => {
    await seedAssignment();
    await seedSubmission(false);

    const assessment = await saveLecturerAssessment(lecturer, 'Tran Thi B', ASSIGNMENT_ID, {
      criterionScores: fullScores,
      latePenaltyWaived: false,
      individual: individualFor(),
    });

    expect(assessment.groupScoreRaw).toBe(policy.rubric.totalPoints);
    expect(assessment.policyVersion).toBe(policy.version);
    expect(assessment.status).toBe('draft');
  });

  it('refuses a rubric with a criterion left unmarked', async () => {
    await seedAssignment();
    const { delivery: _left, ...partial } = fullScores;

    await expect(
      saveLecturerAssessment(lecturer, 'Tran Thi B', ASSIGNMENT_ID, {
        criterionScores: partial,
        latePenaltyWaived: false,
        individual: individualFor(),
      }),
    ).rejects.toThrow(/criterionScoreRequired/);
  });

  it('refuses a member left without an individual score', async () => {
    await seedAssignment();
    const missingOne = individualFor();
    delete missingOne[MEMBERS[2]!.uid];

    await expect(
      saveLecturerAssessment(lecturer, 'Tran Thi B', ASSIGNMENT_ID, {
        criterionScores: fullScores,
        latePenaltyWaived: false,
        individual: missingOne,
      }),
    ).rejects.toThrow(/individualScoreRequired/);
  });

  it('refuses a score above what a criterion is worth', async () => {
    await seedAssignment();

    await expect(
      saveLecturerAssessment(lecturer, 'Tran Thi B', ASSIGNMENT_ID, {
        criterionScores: { ...fullScores, delivery: 40 },
        latePenaltyWaived: false,
        individual: individualFor(),
      }),
    ).rejects.toThrow(/criterionScoreOutOfRange/);
  });
});

describe('what the lecturer sees before publishing', () => {
  it('weights the group and the individual shares as the framework says', async () => {
    await seedAssignment();
    await seedSubmission(false);
    await saveLecturerAssessment(lecturer, 'Tran Thi B', ASSIGNMENT_ID, {
      criterionScores: fullScores,
      latePenaltyWaived: false,
      individual: individualFor(60),
    });

    const preview = await previewGrades(ASSIGNMENT_ID);
    expect(preview).toHaveLength(MEMBERS.length);
    // 100 * 0.8 + 60 * 0.2
    expect(preview[0]?.breakdown.finalScore).toBeCloseTo(92, 6);
  });

  it('deducts the late penalty from work that arrived late', async () => {
    await seedAssignment();
    await seedSubmission(true);
    await saveLecturerAssessment(lecturer, 'Tran Thi B', ASSIGNMENT_ID, {
      criterionScores: fullScores,
      latePenaltyWaived: false,
      individual: individualFor(60),
    });

    const preview = await previewGrades(ASSIGNMENT_ID);
    const penalty = policy.grading.lateSubmissionPenaltyPoints;
    expect(preview[0]?.breakdown.latePenaltyApplied).toBe(penalty);
    expect(preview[0]?.breakdown.finalScore).toBeCloseTo((100 - penalty) * 0.8 + 60 * 0.2, 6);
  });

  it('lets the lecturer waive it, and keeps the reason with the mark', async () => {
    await seedAssignment();
    await seedSubmission(true);
    await saveLecturerAssessment(lecturer, 'Tran Thi B', ASSIGNMENT_ID, {
      criterionScores: fullScores,
      latePenaltyWaived: true,
      latePenaltyWaiverReason: 'Bereavement, confirmed by the faculty office.',
      individual: individualFor(60),
    });

    const preview = await previewGrades(ASSIGNMENT_ID);
    expect(preview[0]?.breakdown.latePenaltyApplied).toBe(0);
    expect((await getLecturerAssessment(ASSIGNMENT_ID))?.latePenaltyWaiverReason).toContain(
      'Bereavement',
    );
  });

  it('forfeits the whole individual share for a member who did not present', async () => {
    await seedAssignment();
    await seedSubmission(false);
    const individual = individualFor(60);
    individual[MEMBERS[3]!.uid] = {
      rawScore: 60,
      didNotPresent: true,
      failedOwnRoleQuestion: false,
    };

    await saveLecturerAssessment(lecturer, 'Tran Thi B', ASSIGNMENT_ID, {
      criterionScores: fullScores,
      latePenaltyWaived: false,
      individual,
    });

    const preview = await previewGrades(ASSIGNMENT_ID);
    const absent = preview.find((row) => row.studentUid === MEMBERS[3]!.uid);
    expect(absent?.breakdown.individualForfeited).toBe(true);
    expect(absent?.breakdown.forfeitReason).toBe('absent');
    expect(absent?.breakdown.finalScore).toBeCloseTo(80, 6);
  });
});

describe('publishing', () => {
  it('gives every member of the group a mark, or none of them', async () => {
    await seedAssignment();
    await seedSubmission(false);
    await saveLecturerAssessment(lecturer, 'Tran Thi B', ASSIGNMENT_ID, {
      criterionScores: fullScores,
      latePenaltyWaived: false,
      individual: individualFor(70),
    });

    const published = await publishGrades(lecturer, ASSIGNMENT_ID);
    expect(published).toHaveLength(MEMBERS.length);

    const stored = await listGradesForAssignment(ASSIGNMENT_ID);
    expect(stored).toHaveLength(MEMBERS.length);
    expect(stored.every((grade) => grade.status === 'published')).toBe(true);
  });

  it('shows a student nothing at all until the moment it is published', async () => {
    await seedAssignment();
    await seedSubmission(false);
    await saveLecturerAssessment(lecturer, 'Tran Thi B', ASSIGNMENT_ID, {
      criterionScores: fullScores,
      latePenaltyWaived: false,
      individual: individualFor(70),
    });

    // Marked, but not published: the student has nothing.
    expect(await listPublishedGradesOfStudent(MEMBERS[0]!.uid)).toHaveLength(0);

    await publishGrades(lecturer, ASSIGNMENT_ID);
    const own = await listPublishedGradesOfStudent(MEMBERS[0]!.uid);
    expect(own).toHaveLength(1);
    expect(own[0]?.finalScore).toBeCloseTo(94, 6);
  });

  it('refuses to publish twice, and refuses a quiet edit afterwards', async () => {
    await seedAssignment();
    await seedSubmission(false);
    await saveLecturerAssessment(lecturer, 'Tran Thi B', ASSIGNMENT_ID, {
      criterionScores: fullScores,
      latePenaltyWaived: false,
      individual: individualFor(70),
    });
    await publishGrades(lecturer, ASSIGNMENT_ID);

    await expect(publishGrades(lecturer, ASSIGNMENT_ID)).rejects.toThrow(/gradeAlreadyPublished/);
    await expect(
      saveLecturerAssessment(lecturer, 'Tran Thi B', ASSIGNMENT_ID, {
        criterionScores: fullScores,
        latePenaltyWaived: false,
        individual: individualFor(20),
      }),
    ).rejects.toThrow(/gradeAlreadyPublished/);

    // And the published marks did not move.
    const stored = await listGradesForAssignment(ASSIGNMENT_ID);
    expect(stored[0]?.finalScore).toBeCloseTo(94, 6);
  });

  it('survives two lecturers pressing publish at the same moment', async () => {
    await seedAssignment();
    await seedSubmission(false);
    await saveLecturerAssessment(lecturer, 'Tran Thi B', ASSIGNMENT_ID, {
      criterionScores: fullScores,
      latePenaltyWaived: false,
      individual: individualFor(70),
    });

    const results = await Promise.allSettled([
      publishGrades(lecturer, ASSIGNMENT_ID),
      publishGrades(lecturer, ASSIGNMENT_ID),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await listGradesForAssignment(ASSIGNMENT_ID)).toHaveLength(MEMBERS.length);
  });

  it('refuses to publish a mark that was never made', async () => {
    await seedAssignment();
    await expect(publishGrades(lecturer, ASSIGNMENT_ID)).rejects.toThrow(/assessmentNotFound/);
  });
});

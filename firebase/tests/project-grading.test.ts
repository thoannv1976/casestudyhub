import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Marking the class group project, against the real database.
 *
 * The point of proving this here rather than in a unit test is that the case
 * study and the project run through *one* pipeline. So what matters is that
 * the pipeline picks the right instrument for the work in front of it, that
 * the two marks sit side by side without overwriting each other, and that a
 * published project mark is as immutable as a published case study mark.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const {
  getDb,
  setProjectDeadline,
  saveLecturerAssessment,
  getLecturerAssessment,
  previewGrades,
  publishGrades,
  listGradesForAssignment,
  createAssignment,
  submitLink,
} = await import('@casestudyhub/core');
const { COLLECTIONS, DEFAULT_PRESENTATION_POLICY, DEFAULT_PROJECT_RUBRIC, projectTargetId } =
  await import('@casestudyhub/shared');

const CLASS_ID = 'PGRD-A01';
const GROUP_ID = 'PGRD-G1';
const CASE_ID = 'PGRD-CASE1';

const policy = DEFAULT_PRESENTATION_POLICY;
const lecturer = { uid: 'pgrd_lecturer', email: 'gv@x.edu.vn', role: 'lecturer' as const };
const student = { uid: 'pgrd_student', email: 'sv@x.edu.vn', role: 'student' as const };

const DAY = 24 * 60 * 60 * 1000;
const REASON = 'Final week of the course, as announced in week one.';
const TARGET = projectTargetId(CLASS_ID, GROUP_ID);

function inDays(days: number): string {
  return new Date(Date.now() + days * DAY).toISOString();
}

/** Full marks on every component of the project rubric. */
function fullMarks(): Record<string, number> {
  return Object.fromEntries(
    DEFAULT_PROJECT_RUBRIC.criteria.map((item) => [item.id, item.maxPoints]),
  );
}

function marksOf(total: number): Record<string, number> {
  // Everything on the first component, zero elsewhere: the arithmetic under
  // test is the bonus and the penalty, not how a lecturer spreads points.
  const scores = Object.fromEntries(DEFAULT_PROJECT_RUBRIC.criteria.map((item) => [item.id, 0]));
  const first = DEFAULT_PROJECT_RUBRIC.criteria[0];
  if (first) scores[first.id] = Math.min(total, first.maxPoints);
  return scores;
}

const individual = {
  [student.uid]: { rawScore: 100, didNotPresent: false, failedOwnRoleQuestion: false },
};

async function seed() {
  const db = getDb();
  await db
    .collection(COLLECTIONS.classes)
    .doc(CLASS_ID)
    .set({
      id: CLASS_ID,
      classCode: 'PGRD01',
      className: 'Thuong mai dien tu',
      courseId: 'PGRD-C1',
      semesterId: 'PGRD-S1',
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
    maxMembers: 6,
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
    caseCode: 'PGRD01',
    title: 'Amazon',
    courseId: 'PGRD-C1',
    language: 'vi',
    status: 'published',
    currentVersionId: 'v1',
  });
}

async function wipe() {
  const db = getDb();
  const jobs = [
    db.collection(COLLECTIONS.groups).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.groupMembers).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.assignments).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.caseStudies).where('courseId', '==', 'PGRD-C1').get(),
    db.collection(COLLECTIONS.lecturerAssessments).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.grades).where('groupId', '==', GROUP_ID).get(),
    db.collection(COLLECTIONS.submissions).where('groupId', '==', GROUP_ID).get(),
    db.collection(COLLECTIONS.notifications).where('recipientUid', '==', student.uid).get(),
    db.collection(COLLECTIONS.auditLogs).where('actorUid', '==', lecturer.uid).get(),
  ];
  for (const snapshot of await Promise.all(jobs)) {
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
  }
  await db.collection(COLLECTIONS.classProjects).doc(CLASS_ID).delete();
  await db.collection(COLLECTIONS.classes).doc(CLASS_ID).delete();
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('These tests must run against the emulator, never a real project.');
  }
});

beforeEach(async () => {
  await wipe();
  await seed();
  await setProjectDeadline(lecturer, CLASS_ID, inDays(30), REASON);
});

afterAll(wipe);

describe('marking the project', () => {
  it('marks it against the project rubric, not the presentation one', async () => {
    const assessment = await saveLecturerAssessment(lecturer, 'GV A', TARGET, {
      criterionScores: fullMarks(),
      latePenaltyWaived: false,
      individual,
    });

    expect(assessment.kind).toBe('group_project');
    expect(assessment.rubricId).toBe(DEFAULT_PROJECT_RUBRIC.id);
    expect(assessment.groupScoreRaw).toBe(100);
    // No case study is involved, so none is recorded.
    expect(assessment.caseStudyId).toBeUndefined();
  });

  it('refuses a criterion the project rubric does not have', async () => {
    await expect(
      saveLecturerAssessment(lecturer, 'GV A', TARGET, {
        criterionScores: { understanding: 20 },
        latePenaltyWaived: false,
        individual,
      }),
    ).rejects.toThrow(/criterionScore/);
  });

  it('refuses a rubric with a gap: an unmarked criterion is not a mark', async () => {
    const partial = fullMarks();
    delete partial['data-kpi'];

    await expect(
      saveLecturerAssessment(lecturer, 'GV A', TARGET, {
        criterionScores: partial,
        latePenaltyWaived: false,
        individual,
      }),
    ).rejects.toThrow(/criterionScoreRequired/);
  });

  it('adds the bonus the framework says the award is worth', async () => {
    await saveLecturerAssessment(lecturer, 'GV A', TARGET, {
      criterionScores: marksOf(10),
      latePenaltyWaived: false,
      individual,
      bonus: { mvp: true, video: true },
    });

    const [row] = await previewGrades(TARGET);
    expect(row?.breakdown.bonusPointsApplied).toBe(15);
    expect(row?.breakdown.groupScoreRaw).toBe(25);
  });

  it('caps a bonus that would take the group past full marks', async () => {
    await saveLecturerAssessment(lecturer, 'GV A', TARGET, {
      criterionScores: fullMarks(),
      latePenaltyWaived: false,
      individual,
      bonus: { mvp: true, video: true },
    });

    const [row] = await previewGrades(TARGET);
    expect(row?.breakdown.groupScoreBeforeCap).toBe(115);
    expect(row?.breakdown.groupScoreRaw).toBe(100);
  });

  it('still takes the late penalty off after the bonus', async () => {
    // Handing in late costs the same whatever the group earned on top.
    await setProjectDeadline(lecturer, CLASS_ID, inDays(-1), 'Deadline was last week, recorded.');
    await submitLink(student, GROUP_ID, {
      assignmentId: TARGET,
      deliverableId: 'project-video',
      url: 'https://youtu.be/late',
    });
    await saveLecturerAssessment(lecturer, 'GV A', TARGET, {
      criterionScores: fullMarks(),
      latePenaltyWaived: false,
      individual,
      bonus: { mvp: true, video: true },
    });

    const [row] = await previewGrades(TARGET);
    expect(row?.breakdown.latePenaltyApplied).toBe(policy.grading.lateSubmissionPenaltyPoints);
    expect(row?.breakdown.groupScoreAfterPenalty).toBe(
      100 - policy.grading.lateSubmissionPenaltyPoints,
    );
  });
});

describe('publishing a project mark', () => {
  beforeEach(async () => {
    await saveLecturerAssessment(lecturer, 'GV A', TARGET, {
      criterionScores: fullMarks(),
      latePenaltyWaived: false,
      individual,
      bonus: { mvp: false, video: true },
    });
  });

  it('records it as the project mark it is', async () => {
    const grades = await publishGrades(lecturer, TARGET);
    expect(grades).toHaveLength(1);
    expect(grades[0]?.kind).toBe('group_project');
    expect(grades[0]?.id).toBe(`${TARGET}__${student.uid}`);
  });

  it('tells the student in a sentence that names no case study', async () => {
    await publishGrades(lecturer, TARGET);

    const snapshot = await getDb()
      .collection(COLLECTIONS.notifications)
      .where('recipientUid', '==', student.uid)
      .get();
    const kinds = snapshot.docs.map((doc) => doc.get('kind'));

    expect(kinds).toContain('grade.projectPublished');
    expect(kinds).not.toContain('grade.published');
  });

  it('cannot be marked again once published', async () => {
    await publishGrades(lecturer, TARGET);
    await expect(
      saveLecturerAssessment(lecturer, 'GV A', TARGET, {
        criterionScores: marksOf(10),
        latePenaltyWaived: false,
        individual,
      }),
    ).rejects.toThrow(/gradeAlreadyPublished/);
  });
});

describe('a class that runs both pieces of work', () => {
  it('keeps the two marks side by side without either overwriting the other', async () => {
    const assignmentId = await createAssignment(lecturer, {
      classId: CLASS_ID,
      groupId: GROUP_ID,
      caseStudyId: CASE_ID,
      presentationDate: inDays(10),
    });

    await saveLecturerAssessment(lecturer, 'GV A', assignmentId, {
      criterionScores: Object.fromEntries(
        policy.rubric.criteria.map((item) => [item.id, item.maxPoints]),
      ),
      latePenaltyWaived: false,
      individual,
    });
    await saveLecturerAssessment(lecturer, 'GV A', TARGET, {
      criterionScores: marksOf(10),
      latePenaltyWaived: false,
      individual,
    });

    const caseAssessment = await getLecturerAssessment(assignmentId);
    const projectAssessment = await getLecturerAssessment(TARGET);

    expect(caseAssessment?.kind).toBe('case_study');
    expect(caseAssessment?.rubricId).toBe(policy.rubric.id);
    expect(projectAssessment?.kind).toBe('group_project');
    expect(projectAssessment?.rubricId).toBe(DEFAULT_PROJECT_RUBRIC.id);

    await publishGrades(lecturer, assignmentId);
    await publishGrades(lecturer, TARGET);

    expect(await listGradesForAssignment(assignmentId)).toHaveLength(1);
    expect(await listGradesForAssignment(TARGET)).toHaveLength(1);
  });
});

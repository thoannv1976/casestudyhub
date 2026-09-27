import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * The class overview, against the real database.
 *
 * Two things are worth a database to prove. That it reads both pieces of work
 * a group owes and tells them apart - the table is useless if a case study and
 * the project blur into one row. And that it costs a handful of queries for a
 * class of any size: done per row it would be about a hundred and eighty, and
 * the page would get slower every week of term.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const {
  getDb,
  classOverview,
  createAssignment,
  setProjectDeadline,
  saveLecturerAssessment,
  publishGrades,
  submitLink,
  submitDeliverable,
} = await import('@casestudyhub/core');
const { COLLECTIONS, DEFAULT_PRESENTATION_POLICY, DEFAULT_PROJECT_RUBRIC, projectTargetId } =
  await import('@casestudyhub/shared');

const CLASS_ID = 'OVW-A01';
const CASE_ID = 'OVW-CASE1';
const policy = DEFAULT_PRESENTATION_POLICY;
const lecturer = { uid: 'ovw_lecturer', email: 'gv@x.edu.vn', role: 'lecturer' as const };

const DAY = 24 * 60 * 60 * 1000;
const REASON = 'Final week of the course, as announced in week one.';

function inDays(days: number): string {
  return new Date(Date.now() + days * DAY).toISOString();
}

/** Six groups, each with one student, which is enough to join on. */
const GROUPS = [1, 2, 3, 4, 5, 6].map((index) => ({
  id: `OVW-G${index}`,
  name: `Nhom ${index}`,
  student: {
    uid: `ovw_student_${index}`,
    email: `sv${index}@x.edu.vn`,
    role: 'student' as const,
  },
}));

async function seed() {
  const db = getDb();
  await db
    .collection(COLLECTIONS.classes)
    .doc(CLASS_ID)
    .set({
      id: CLASS_ID,
      classCode: 'OVW01',
      className: 'Thuong mai dien tu',
      courseId: 'OVW-C1',
      semesterId: 'OVW-S1',
      lecturerIds: [lecturer.uid],
      language: 'vi',
      presentationPolicyId: policy.id,
      presentationPolicyVersion: policy.version,
      joinMode: 'code',
      caseSelection: 'lecturer_assigns',
      status: 'active',
    });

  for (const group of GROUPS) {
    await db.collection(COLLECTIONS.groups).doc(group.id).set({
      id: group.id,
      groupCode: group.id,
      groupName: group.name,
      classId: CLASS_ID,
      maxMembers: 6,
      memberCount: 1,
      formationMode: 'lecturer_assignment',
      locked: false,
      status: 'forming',
    });
    await db
      .collection(COLLECTIONS.groupMembers)
      .doc(`${CLASS_ID}__${group.student.uid}`)
      .set({
        id: `${CLASS_ID}__${group.student.uid}`,
        classId: CLASS_ID,
        groupId: group.id,
        studentUid: group.student.uid,
        studentId: group.student.uid.toUpperCase(),
        fullName: group.name,
        roleIds: [],
        isLeader: true,
      });
  }

  await db.collection(COLLECTIONS.caseStudies).doc(CASE_ID).set({
    id: CASE_ID,
    caseCode: 'OVW01',
    title: 'Amazon',
    courseId: 'OVW-C1',
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
    db.collection(COLLECTIONS.caseStudies).where('courseId', '==', 'OVW-C1').get(),
    db.collection(COLLECTIONS.lecturerAssessments).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.auditLogs).where('actorUid', '==', lecturer.uid).get(),
    ...GROUPS.map((group) =>
      db.collection(COLLECTIONS.grades).where('groupId', '==', group.id).get(),
    ),
    ...GROUPS.map((group) =>
      db.collection(COLLECTIONS.submissions).where('groupId', '==', group.id).get(),
    ),
    ...GROUPS.map((group) =>
      db.collection(COLLECTIONS.notifications).where('recipientUid', '==', group.student.uid).get(),
    ),
  ];
  for (const snapshot of await Promise.all(jobs)) {
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
  }
  await db.collection(COLLECTIONS.classProjects).doc(CLASS_ID).delete();
  await db.collection(COLLECTIONS.classes).doc(CLASS_ID).delete();
}

function fullProjectMarks(): Record<string, number> {
  return Object.fromEntries(
    DEFAULT_PROJECT_RUBRIC.criteria.map((item) => [item.id, item.maxPoints]),
  );
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

describe('a class with nothing set yet', () => {
  it('says so instead of failing', async () => {
    const overview = await classOverview(CLASS_ID);
    expect(overview.rows).toEqual([]);
    expect(overview.totals.work).toBe(0);
  });
});

describe('a class running both pieces of work', () => {
  beforeEach(async () => {
    await setProjectDeadline(lecturer, CLASS_ID, inDays(30), REASON);
    for (const group of GROUPS.slice(0, 2)) {
      await createAssignment(lecturer, {
        classId: CLASS_ID,
        groupId: group.id,
        caseStudyId: CASE_ID,
        presentationDate: inDays(10),
      });
    }
  });

  it('gives every group a project row and each assignment its own', async () => {
    const overview = await classOverview(CLASS_ID);

    // Six groups owe the project; two of them also owe a case study.
    expect(overview.rows.filter((row) => row.kind === 'group_project')).toHaveLength(6);
    expect(overview.rows.filter((row) => row.kind === 'case_study')).toHaveLength(2);
    expect(overview.totals.work).toBe(8);
  });

  it('tells the two kinds apart rather than blurring them into one row', async () => {
    const overview = await classOverview(CLASS_ID);
    const forGroupOne = overview.rows.filter((row) => row.groupId === GROUPS[0]?.id);

    expect(forGroupOne).toHaveLength(2);
    // The case names itself; the project is named by the interface, not by a
    // sentence stored in the database.
    expect(forGroupOne.find((row) => row.kind === 'case_study')?.subject).toBe('Amazon');
    expect(forGroupOne.find((row) => row.kind === 'group_project')?.subject).toBeNull();
  });

  it('counts what each piece of work owes from the framework it froze', async () => {
    const overview = await classOverview(CLASS_ID);
    const project = overview.rows.find((row) => row.kind === 'group_project');
    const caseStudy = overview.rows.find((row) => row.kind === 'case_study');

    expect(project?.requiredCount).toBe(3);
    expect(caseStudy?.requiredCount).toBe(
      policy.deliverables.filter((item) => item.required).length,
    );
  });

  it('follows one group from nothing handed in to a published mark', async () => {
    const group = GROUPS[0];
    if (!group) throw new Error('seed is wrong');
    const target = projectTargetId(CLASS_ID, group.id);

    const before = await classOverview(CLASS_ID);
    const beforeRow = before.rows.find((row) => row.targetId === target);
    expect(beforeRow).toMatchObject({ handedInCount: 0, marking: 'unmarked' });
    expect(beforeRow?.progress.state).toBe('awaiting');

    await submitLink(group.student, group.id, {
      assignmentId: target,
      deliverableId: 'project-video',
      url: 'https://youtu.be/one',
    });
    await submitDeliverable(group.student, group.id, {
      assignmentId: target,
      deliverableId: 'project-report',
      fileName: 'report.pdf',
      contentType: 'application/pdf',
      body: Buffer.from('%PDF-1.4 report'),
    });

    const partway = await classOverview(CLASS_ID);
    expect(partway.rows.find((row) => row.targetId === target)).toMatchObject({
      handedInCount: 2,
      marking: 'unmarked',
    });
    expect(partway.totals.missing).toBeGreaterThan(0);

    await saveLecturerAssessment(lecturer, 'GV A', target, {
      criterionScores: fullProjectMarks(),
      latePenaltyWaived: false,
      individual: {
        [group.student.uid]: {
          rawScore: 80,
          didNotPresent: false,
          failedOwnRoleQuestion: false,
        },
      },
      bonus: { mvp: true, video: false },
    });

    const drafted = await classOverview(CLASS_ID);
    expect(drafted.rows.find((row) => row.targetId === target)).toMatchObject({
      marking: 'draft',
      groupScoreRaw: 100,
      // Worth what the frozen framework says, not what today's says.
      bonusPoints: 10,
      averageFinalScore: null,
    });

    await publishGrades(lecturer, target);

    const published = await classOverview(CLASS_ID);
    const row = published.rows.find((candidate) => candidate.targetId === target);
    expect(row?.marking).toBe('published');
    // 100 capped, weighted 80/20 against an individual 80.
    expect(row?.averageFinalScore).toBe(96);
    expect(row?.gradedStudents).toBe(1);
    expect(published.totals.published).toBe(1);
  });

  it('costs a handful of queries for the whole class, not one per row', async () => {
    // Eight rows here; a hundred groups would still be these queries. Done per
    // row this page would slow down every week of term.
    const queries: string[] = [];
    await classOverview(CLASS_ID, { onQuery: (label) => queries.push(label) });

    expect(queries).toEqual([
      'groups',
      'members',
      'assignments',
      'cases',
      'project',
      'assessments',
      'submissions',
      'grades',
    ]);
  });
});

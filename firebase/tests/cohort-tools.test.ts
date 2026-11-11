import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Tools for starting a new cohort and running a class (plan of 11/11/2026),
 * against the real Firestore emulator.
 *
 * What these protect: a Moodle course moved to a new class takes every
 * activity and gradebook target with it, and never once marks are out; a
 * cloned class carries the course's settings but no people; reminders reach
 * only the groups that owe work; small groups are only emptied when nothing
 * of theirs would be lost; and a student with no group is not told their group
 * handed everything in.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const {
  getDb,
  classOverview,
  createAssignment,
  cloneClassForNewCohort,
  dashboardFor,
  listGroups,
  listMembers,
  ltiRosterMatch,
  mergeSmallGroups,
  relinkLtiCourse,
  remindMissingWork,
  setAllGroupsLocked,
} = await import('@casestudyhub/core');
const { COLLECTIONS, DEFAULT_PRESENTATION_POLICY } = await import('@casestudyhub/shared');
const { FieldValue, Timestamp } = await import('firebase-admin/firestore');

const CLASS_ID = 'COH-A01';
const NEXT_ID = 'COH-B01';
const CASE_ID = 'COH-CASE1';
const COURSE_ID = 'COH-C1';
const SEMESTER_ID = 'COH-S1';
const CONTEXT_KEY = 'c'.repeat(40);
const policy = DEFAULT_PRESENTATION_POLICY;
const lecturer = { uid: 'coh_lecturer', email: 'gv@x.edu.vn', role: 'lecturer' as const };
const stranger = { uid: 'coh_other', email: 'khac@x.edu.vn', role: 'lecturer' as const };
const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const GROUPS = [1, 2, 3, 4, 5, 6].map((index) => ({
  id: `COH-G${index}`,
  name: `Nhom ${index}`,
  student: { uid: `coh_student_${index}`, email: `sv${index}@x.edu.vn`, role: 'student' as const },
}));

function classDoc(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    classCode: id.replace('-', ''),
    className: 'Thuong mai dien tu',
    courseId: COURSE_ID,
    semesterId: SEMESTER_ID,
    lecturerIds: [lecturer.uid],
    language: 'vi',
    presentationPolicyId: policy.id,
    presentationPolicyVersion: policy.version,
    joinMode: 'code',
    caseSelection: 'lecturer_assigns',
    studentCount: 0,
    status: 'active',
    ...extra,
  };
}

async function seed() {
  const db = getDb();
  await db.collection(COLLECTIONS.courses).doc(COURSE_ID).set({ id: COURSE_ID, code: 'ECOM' });
  await db.collection(COLLECTIONS.semesters).doc(SEMESTER_ID).set({ id: SEMESTER_ID });
  await db.collection(COLLECTIONS.classes).doc(CLASS_ID).set(classDoc(CLASS_ID));
  await db.collection(COLLECTIONS.classes).doc(NEXT_ID).set(classDoc(NEXT_ID));
  for (const group of GROUPS) {
    await db.collection(COLLECTIONS.groups).doc(group.id).set({
      id: group.id,
      groupCode: group.id,
      groupName: group.name,
      classId: CLASS_ID,
      maxMembers: 6,
      memberCount: 1,
      formationMode: 'student_self_join',
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
    caseCode: 'COH01',
    title: 'Amazon',
    courseId: COURSE_ID,
    language: 'vi',
    status: 'published',
    currentVersionId: 'v1',
  });
}

async function wipe() {
  const db = getDb();
  const classIds = [CLASS_ID, NEXT_ID];
  const cloned = await db.collection(COLLECTIONS.classes).where('courseId', '==', COURSE_ID).get();
  classIds.push(...cloned.docs.map((doc) => doc.id));
  const jobs = [
    ...classIds.flatMap((id) => [
      db.collection(COLLECTIONS.groups).where('classId', '==', id).get(),
      db.collection(COLLECTIONS.groupMembers).where('classId', '==', id).get(),
      db.collection(COLLECTIONS.assignments).where('classId', '==', id).get(),
      db.collection(COLLECTIONS.classEnrollments).where('classId', '==', id).get(),
      db.collection(COLLECTIONS.lecturerAssessments).where('classId', '==', id).get(),
      db.collection(COLLECTIONS.ltiGradeTargets).where('classId', '==', id).get(),
      db.collection(COLLECTIONS.ltiActivities).where('classId', '==', id).get(),
    ]),
    db.collection(COLLECTIONS.caseStudies).where('courseId', '==', COURSE_ID).get(),
    db.collection(COLLECTIONS.caseClaims).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.auditLogs).where('actorUid', '==', lecturer.uid).get(),
    ...GROUPS.map((group) =>
      db.collection(COLLECTIONS.notifications).where('recipientUid', '==', group.student.uid).get(),
    ),
  ];
  for (const snapshot of await Promise.all(jobs)) {
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
  }
  for (const id of classIds) await db.collection(COLLECTIONS.classes).doc(id).delete();
  await db.collection(COLLECTIONS.ltiContexts).doc(CONTEXT_KEY).delete();
  await db.collection(COLLECTIONS.courses).doc(COURSE_ID).delete();
  await db.collection(COLLECTIONS.semesters).doc(SEMESTER_ID).delete();
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

describe('moving a Moodle course to another class', () => {
  beforeEach(async () => {
    const db = getDb();
    await db.collection(COLLECTIONS.ltiContexts).doc(CONTEXT_KEY).set({
      key: CONTEXT_KEY,
      classId: CLASS_ID,
      title: 'Ecommerce 2026 OCT',
    });
    await db
      .collection(COLLECTIONS.ltiActivities)
      .doc('res-case')
      .set({ key: 'res-case', contextKey: CONTEXT_KEY, classId: CLASS_ID, kind: 'case_study' });
    await db
      .collection(COLLECTIONS.ltiGradeTargets)
      .doc('u1__res-case')
      .set({ uid: 'u1', resourceKey: 'res-case', classId: CLASS_ID, gradeTarget: 'g1' });
    await db
      .collection(COLLECTIONS.ltiGradeTargets)
      .doc('u1__res-elsewhere')
      .set({ uid: 'u1', resourceKey: 'res-elsewhere', classId: CLASS_ID, gradeTarget: 'g2' });
  });

  it('takes the course, its activities and their gradebook targets to the new class', async () => {
    const result = await relinkLtiCourse(lecturer, CONTEXT_KEY, NEXT_ID);
    expect(result.activities).toBe(1);

    const db = getDb();
    const context = await db.collection(COLLECTIONS.ltiContexts).doc(CONTEXT_KEY).get();
    expect(context.get('classId')).toBe(NEXT_ID);
    expect(context.get('previousClassIds')).toEqual([CLASS_ID]);
    const activity = await db.collection(COLLECTIONS.ltiActivities).doc('res-case').get();
    expect(activity.get('classId')).toBe(NEXT_ID);
    const moved = await db.collection(COLLECTIONS.ltiGradeTargets).doc('u1__res-case').get();
    expect(moved.get('classId')).toBe(NEXT_ID);
    // A target of an activity in another course stays where it was.
    const other = await db.collection(COLLECTIONS.ltiGradeTargets).doc('u1__res-elsewhere').get();
    expect(other.get('classId')).toBe(CLASS_ID);
  });

  it('is refused once the old class has published marks', async () => {
    await getDb()
      .collection(COLLECTIONS.lecturerAssessments)
      .doc('COH-A1')
      .set({ assignmentId: 'COH-A1', classId: CLASS_ID, status: 'published' });
    await expect(relinkLtiCourse(lecturer, CONTEXT_KEY, NEXT_ID)).rejects.toMatchObject({
      messageKey: 'errors.ltiRelinkHasGrades',
    });
  });

  it('is refused to a lecturer who does not teach both classes', async () => {
    await expect(relinkLtiCourse(stranger, CONTEXT_KEY, NEXT_ID)).rejects.toMatchObject({
      messageKey: 'errors.notYourClass',
    });
  });
});

describe('spotting a Moodle course linked to the wrong class', () => {
  async function enrol(index: number, joinedVia: string, createdDaysAgo: number) {
    const id = `${CLASS_ID}__SV${index}`;
    await getDb()
      .collection(COLLECTIONS.classEnrollments)
      .doc(id)
      .set({
        id,
        classId: CLASS_ID,
        studentId: `SV${index}`,
        studentUid: `uid_${index}`,
        fullName: `Sinh vien ${index}`,
        email: `sv${index}@x.edu.vn`,
        status: 'active',
        joinedVia,
        createdAt: Timestamp.fromMillis(Date.now() - createdDaysAgo * DAY),
        joinedAt: FieldValue.serverTimestamp(),
      });
  }

  it('warns when most people Moodle brings were not on the class roster', async () => {
    for (let index = 1; index <= 6; index += 1) await enrol(index, 'class_code', 40);
    for (let index = 7; index <= 9; index += 1) await enrol(index, 'lti', 0);
    await enrol(10, 'lti', 40); // on the roster before, matched by student code

    const match = await ltiRosterMatch(CLASS_ID);
    expect(match).toEqual({
      fromMoodle: 4,
      newFromMoodle: 3,
      joinedOtherwise: 6,
      likelyWrongClass: true,
    });
  });

  it('stays quiet when Moodle brings the class its own students', async () => {
    for (let index = 1; index <= 6; index += 1) await enrol(index, 'lti', 40);
    expect((await ltiRosterMatch(CLASS_ID)).likelyWrongClass).toBe(false);
  });
});

describe('opening a class for the next cohort', () => {
  it('carries the course, cases and settings, and none of the people', async () => {
    await getDb()
      .collection(COLLECTIONS.classes)
      .doc(CLASS_ID)
      .update({
        caseSelection: 'groups_choose',
        caseSetIds: [CASE_ID],
        groupsPerCase: 2,
        afterClassQa: { askDays: 3, answerDays: 5 },
        liveQaUrl: 'https://classinteractive.web.app/classes/x',
        studentCount: 86,
      });

    const deadline = inDays(14);
    const newId = await cloneClassForNewCohort(lecturer, CLASS_ID, {
      classCode: 'COH-NEXT',
      className: 'Thuong mai dien tu – khoa moi',
      groupCount: 4,
      maxMembers: 7,
      caseSelectionDeadline: deadline,
    });

    const copy = (await getDb().collection(COLLECTIONS.classes).doc(newId).get()).data()!;
    expect(copy).toMatchObject({
      classCode: 'COH-NEXT',
      courseId: COURSE_ID,
      semesterId: SEMESTER_ID,
      caseSelection: 'groups_choose',
      caseSelectionDeadline: new Date(deadline).toISOString(),
      caseSetIds: [CASE_ID],
      groupsPerCase: 2,
      afterClassQa: { askDays: 3, answerDays: 5 },
      liveQaUrl: 'https://classinteractive.web.app/classes/x',
      clonedFromClassId: CLASS_ID,
      studentCount: 0,
      status: 'active',
    });
    expect(copy.lecturerIds).toContain(lecturer.uid);

    const groups = await listGroups(newId);
    expect(groups).toHaveLength(4);
    expect(groups.every((group) => group.memberCount === 0 && group.maxMembers === 7)).toBe(true);
    expect(await listMembers(newId)).toEqual([]);
  });

  it('refuses a class code that is already taken', async () => {
    await expect(
      cloneClassForNewCohort(lecturer, CLASS_ID, {
        classCode: 'COHA01',
        className: 'Trung ma',
        groupCount: 2,
        maxMembers: 6,
      }),
    ).rejects.toMatchObject({ messageKey: 'errors.classCodeTaken' });
  });

  it('is refused for a class the lecturer does not teach', async () => {
    await expect(
      cloneClassForNewCohort(stranger, CLASS_ID, {
        classCode: 'COH-X',
        className: 'Khong phai lop minh',
        groupCount: 2,
        maxMembers: 6,
      }),
    ).rejects.toMatchObject({ messageKey: 'errors.notYourClass' });
  });
});

describe('reminding groups that still owe work', () => {
  beforeEach(async () => {
    for (const group of GROUPS.slice(0, 2)) {
      await createAssignment(lecturer, {
        classId: CLASS_ID,
        groupId: group.id,
        caseStudyId: CASE_ID,
        presentationDate: inDays(10),
      });
    }
  });

  it('names what each group is missing in the overview', async () => {
    const overview = await classOverview(CLASS_ID);
    const row = overview.rows.find((item) => item.groupId === GROUPS[0]!.id)!;
    expect(row.missingItems).toContain('deliverables.slidesPdf');
    expect(row.missingItems).toHaveLength(row.requiredCount);
  });

  it('tells only those groups, once, and not twice within twelve hours', async () => {
    const result = await remindMissingWork(lecturer, CLASS_ID);
    expect(result).toEqual({ groups: 2, students: 2 });

    const db = getDb();
    const told = await db
      .collection(COLLECTIONS.notifications)
      .where('recipientUid', '==', GROUPS[0]!.student.uid)
      .get();
    expect(told.docs.map((doc) => doc.get('kind'))).toContain('submission.reminder');
    const reminder = told.docs.find((doc) => doc.get('kind') === 'submission.reminder')!;
    expect(reminder.get('params')).toMatchObject({ case: 'Amazon', kind: 'case_study' });

    const untold = await db
      .collection(COLLECTIONS.notifications)
      .where('recipientUid', '==', GROUPS[2]!.student.uid)
      .get();
    expect(untold.docs.filter((doc) => doc.get('kind') === 'submission.reminder')).toEqual([]);

    await expect(remindMissingWork(lecturer, CLASS_ID)).rejects.toMatchObject({
      messageKey: 'errors.reminderTooSoon',
    });
  });
});

describe('whole-class group tools', () => {
  it('locks and unlocks every group at once', async () => {
    expect(await setAllGroupsLocked(lecturer, CLASS_ID, true)).toEqual({ changed: 6 });
    expect((await listGroups(CLASS_ID)).every((group) => group.locked)).toBe(true);
    expect(await setAllGroupsLocked(lecturer, CLASS_ID, true)).toEqual({ changed: 0 });
    expect(await setAllGroupsLocked(lecturer, CLASS_ID, false)).toEqual({ changed: 6 });
  });

  it('empties near-empty groups into a group with room, never one that holds work', async () => {
    // Group 1 has an assignment: it is never emptied, but it may take people.
    await createAssignment(lecturer, {
      classId: CLASS_ID,
      groupId: GROUPS[0]!.id,
      caseStudyId: CASE_ID,
      presentationDate: inDays(10),
    });

    const result = await mergeSmallGroups(lecturer, CLASS_ID, 1);
    expect(result).toEqual({ moved: 5, emptied: 5, stuck: 0 });

    const members = await listMembers(CLASS_ID);
    expect(members.every((member) => member.groupId === GROUPS[0]!.id)).toBe(true);
    const first = (await listGroups(CLASS_ID)).find((group) => group.id === GROUPS[0]!.id)!;
    expect(first.memberCount).toBe(6);
  });

  it('leaves people where they are when no group has room', async () => {
    const db = getDb();
    for (const group of GROUPS) {
      await db.collection(COLLECTIONS.groups).doc(group.id).update({ maxMembers: 1 });
    }
    expect(await mergeSmallGroups(lecturer, CLASS_ID, 1)).toEqual({
      moved: 0,
      emptied: 0,
      stuck: 6,
    });
  });
});

describe('a student with no group yet', () => {
  it('is told so, not that their group handed everything in', async () => {
    const loner = { uid: 'coh_loner', email: 'loner@x.edu.vn', role: 'student' as const };
    const id = `${CLASS_ID}__LONER`;
    await getDb().collection(COLLECTIONS.classEnrollments).doc(id).set({
      id,
      classId: CLASS_ID,
      studentId: 'LONER',
      studentUid: loner.uid,
      fullName: 'Chua co nhom',
      email: loner.email,
      status: 'active',
      joinedVia: 'lti',
    });

    const board = await dashboardFor(loner);
    expect(board.outstanding).toEqual([]);
    expect(board.withoutGroup).toEqual([{ classId: CLASS_ID, className: 'Thuong mai dien tu' }]);

    const grouped = await dashboardFor(GROUPS[0]!.student);
    expect(grouped.withoutGroup).toEqual([]);
  });
});

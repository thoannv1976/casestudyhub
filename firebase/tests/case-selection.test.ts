import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Groups choosing their own case, against the real database.
 *
 * The rule worth proving is the one a spreadsheet cannot keep: two groups
 * pressing the button at the same instant. That is not handled by checking
 * before writing - it is handled by the document id, and this file races two
 * claims to show it.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const {
  getDb,
  submitLink,
  listSubmissions,
  readSubmissionFile,
  setCaseSelection,
  claimCase,
  releaseClaim,
  listClaims,
  choosableCases,
  createAssignment,
  setClassCaseSet,
  copyCaseSet,
  caseSetOfClass,
  assertCanReadCase,
  filterCasesForStudent,
  getCase,
} = await import('@casestudyhub/core');
const { COLLECTIONS, DEFAULT_PRESENTATION_POLICY, caseClaimId } =
  await import('@casestudyhub/shared');

const CLASS_ID = 'CS-A01';
/** A second class, for copying a set across and for reading from outside. */
const CLASS_TWO = 'CS-A02';
const GROUP_A = 'CS-G1';
const GROUP_B = 'CS-G2';
const GROUP_C = 'CS-G3';
const CASE_ONE = 'CS-CASE1';
const CASE_TWO = 'CS-CASE2';
const DRAFT_CASE = 'CS-CASE3';
/** Filed under another course: offered only through a class's own set. */
const OTHER_COURSE_CASE = 'CS-CASE4';

const policy = DEFAULT_PRESENTATION_POLICY;
const lecturer = { uid: 'cs_lecturer', email: 'gv@x.edu.vn', role: 'lecturer' as const };
const inA = { uid: 'cs_student_a', email: 'a@x.edu.vn', role: 'student' as const };
const inB = { uid: 'cs_student_b', email: 'b@x.edu.vn', role: 'student' as const };
const inC = { uid: 'cs_student_d', email: 'd@x.edu.vn', role: 'student' as const };
const otherLecturer = { uid: 'cs_lecturer_2', email: 'gv2@x.edu.vn', role: 'lecturer' as const };
const grouplesss = { uid: 'cs_student_c', email: 'c@x.edu.vn', role: 'student' as const };
const outsider = { uid: 'cs_outsider', email: 'o@x.edu.vn', role: 'student' as const };

async function seedClass(
  caseSelection: 'lecturer_assigns' | 'groups_choose',
  deadline?: string,
  extra: Record<string, unknown> = {},
  classId = CLASS_ID,
) {
  await getDb()
    .collection(COLLECTIONS.classes)
    .doc(classId)
    .set({
      id: classId,
      classCode: classId === CLASS_ID ? 'CS01' : 'CS02',
      className: 'Thuong mai dien tu',
      courseId: 'CS-C1',
      semesterId: 'CS-S1',
      lecturerIds: [lecturer.uid],
      language: 'vi',
      presentationPolicyId: policy.id,
      presentationPolicyVersion: policy.version,
      joinMode: 'code',
      caseSelection,
      ...(deadline ? { caseSelectionDeadline: deadline } : {}),
      ...extra,
      status: 'active',
    });
}

async function seedCase(
  caseId: string,
  title: string,
  status: 'published' | 'draft',
  courseId = 'CS-C1',
) {
  await getDb().collection(COLLECTIONS.caseStudies).doc(caseId).set({
    id: caseId,
    caseCode: caseId,
    title,
    courseId,
    language: 'vi',
    status,
    currentVersionId: 'v1',
  });
}

async function seedMember(uid: string, groupId: string | null, classId = CLASS_ID) {
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

async function seedGroup(groupId: string, groupName: string, classId = CLASS_ID) {
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

async function wipe() {
  const db = getDb();
  const jobs = [
    ...[CLASS_ID, CLASS_TWO].flatMap((classId) => [
      db.collection(COLLECTIONS.caseClaims).where('classId', '==', classId).get(),
      db.collection(COLLECTIONS.classEnrollments).where('classId', '==', classId).get(),
      db.collection(COLLECTIONS.groupMembers).where('classId', '==', classId).get(),
      db.collection(COLLECTIONS.groups).where('classId', '==', classId).get(),
      db.collection(COLLECTIONS.assignments).where('classId', '==', classId).get(),
    ]),
    db.collection(COLLECTIONS.submissions).where('assignmentId', '==', 'CS-A1').get(),
    db.collection(COLLECTIONS.caseStudies).where('courseId', 'in', ['CS-C1', 'CS-C2']).get(),
    // Cleared between tests too: a `.find()` over a log that still holds the
    // previous test's entry finds the previous test's answer.
    ...[lecturer.uid, otherLecturer.uid, inA.uid, inB.uid, inC.uid].map((uid) =>
      db.collection(COLLECTIONS.auditLogs).where('actorUid', '==', uid).get(),
    ),
  ];
  for (const snapshot of await Promise.all(jobs)) {
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
  }
  await db.collection(COLLECTIONS.classes).doc(CLASS_ID).delete();
  await db.collection(COLLECTIONS.classes).doc(CLASS_TWO).delete();
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('These tests must run against the emulator, never a real project.');
  }
});

beforeEach(async () => {
  await wipe();
  await seedClass('groups_choose');
  await seedGroup(GROUP_A, 'Nhom 1');
  await seedGroup(GROUP_B, 'Nhom 2');
  await seedGroup(GROUP_C, 'Nhom 3');
  await seedMember(inA.uid, GROUP_A);
  await seedMember(inB.uid, GROUP_B);
  await seedMember(inC.uid, GROUP_C);
  await seedMember(grouplesss.uid, null);
  await seedCase(CASE_ONE, 'Amazon', 'published');
  await seedCase(CASE_TWO, 'Walmart', 'published');
  await seedCase(DRAFT_CASE, 'Chua cong bo', 'draft');
  await seedCase(OTHER_COURSE_CASE, 'Netflix', 'published', 'CS-C2');
});

afterAll(wipe);

describe('two groups, one case', () => {
  it('gives the case to exactly one of two simultaneous claims', async () => {
    // The point of the whole feature. Not "we check first": the id is the rule.
    const results = await Promise.allSettled([
      claimCase(inA, CLASS_ID, CASE_ONE),
      claimCase(inB, CLASS_ID, CASE_ONE),
    ]);

    const won = results.filter((result) => result.status === 'fulfilled');
    const lost = results.filter((result) => result.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);

    const claims = await listClaims(CLASS_ID);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.id).toBe(caseClaimId(CLASS_ID, CASE_ONE));
  });

  it('tells the group that lost to choose something else', async () => {
    await claimCase(inA, CLASS_ID, CASE_ONE);
    await expect(claimCase(inB, CLASS_ID, CASE_ONE)).rejects.toThrow(/caseAlreadyTaken/);
  });

  it('lets the other group take a different case', async () => {
    await claimCase(inA, CLASS_ID, CASE_ONE);
    const second = await claimCase(inB, CLASS_ID, CASE_TWO);

    expect(second.groupId).toBe(GROUP_B);
    expect(await listClaims(CLASS_ID)).toHaveLength(2);
  });

  it('stops one group holding two cases', async () => {
    await claimCase(inA, CLASS_ID, CASE_ONE);
    await expect(claimCase(inA, CLASS_ID, CASE_TWO)).rejects.toThrow(/groupAlreadyChose/);
  });

  it('holds when the same group races itself for two different cases', async () => {
    const results = await Promise.allSettled([
      claimCase(inA, CLASS_ID, CASE_ONE),
      claimCase(inA, CLASS_ID, CASE_TWO),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });
});

describe('who may choose, and when', () => {
  it('refuses while the lecturer is the one who assigns', async () => {
    await seedClass('lecturer_assigns');
    await expect(claimCase(inA, CLASS_ID, CASE_ONE)).rejects.toThrow(/caseSelectionNotOpen/);
  });

  it('refuses after the deadline the lecturer set', async () => {
    await seedClass('groups_choose', new Date(Date.now() - 3600_000).toISOString());
    await expect(claimCase(inA, CLASS_ID, CASE_ONE)).rejects.toThrow(/caseSelectionClosed/);
  });

  it('allows it right up to the deadline', async () => {
    await seedClass('groups_choose', new Date(Date.now() + 3600_000).toISOString());
    await expect(claimCase(inA, CLASS_ID, CASE_ONE)).resolves.toBeTruthy();
  });

  it('refuses a student who is in the class but not in a group', async () => {
    // A case belongs to a group, so there is nobody for the claim to belong to.
    await expect(claimCase(grouplesss, CLASS_ID, CASE_ONE)).rejects.toThrow(/noGroupYet/);
  });

  it('refuses somebody who is not in the class at all', async () => {
    await expect(claimCase(outsider, CLASS_ID, CASE_ONE)).rejects.toThrow(/notInThisClass/);
  });

  it('refuses a case the students cannot even read yet', async () => {
    await expect(claimCase(inA, CLASS_ID, DRAFT_CASE)).rejects.toThrow(/caseNotPublished/);
  });

  it('records who pressed it, so a dispute has a name on it', async () => {
    const claim = await claimCase(inA, CLASS_ID, CASE_ONE);
    expect(claim.claimedByUid).toBe(inA.uid);
    expect(claim.claimedByName).toBe(inA.uid);
    expect(claim.groupId).toBe(GROUP_A);
  });
});

describe('what a group sees while choosing', () => {
  it('lists taken cases rather than hiding them', async () => {
    await claimCase(inA, CLASS_ID, CASE_ONE);

    const state = await choosableCases(CLASS_ID);
    const taken = state.cases.find((row) => row.study.id === CASE_ONE);
    const free = state.cases.find((row) => row.study.id === CASE_TWO);

    expect(taken?.claims.map((claim) => claim.groupId)).toEqual([GROUP_A]);
    expect(free?.claims).toEqual([]);
    // A draft case is offered to nobody.
    expect(state.cases.some((row) => row.study.id === DRAFT_CASE)).toBe(false);
    // Nor a case filed under another course, while the class has no set.
    expect(state.cases.some((row) => row.study.id === OTHER_COURSE_CASE)).toBe(false);
  });

  it('says the window is shut, and why, decided by the server clock', async () => {
    await seedClass('groups_choose', new Date(Date.now() - 1000).toISOString());
    const state = await choosableCases(CLASS_ID);

    expect(state.open).toBe(false);
    expect(state.closedBecause).toBe('errors.caseSelectionClosed');
  });
});

describe('the lecturer changing their mind', () => {
  it('frees a case again, with a reason recorded', async () => {
    await claimCase(inA, CLASS_ID, CASE_ONE);
    await releaseClaim(lecturer, CLASS_ID, CASE_ONE, 'The group asked to swap after reading it.');

    expect(await listClaims(CLASS_ID)).toHaveLength(0);
    // And now somebody else can have it.
    await expect(claimCase(inB, CLASS_ID, CASE_ONE)).resolves.toBeTruthy();
  });

  it('will not free a case that has become a scheduled assignment', async () => {
    await claimCase(inA, CLASS_ID, CASE_ONE);
    await createAssignment(lecturer, {
      classId: CLASS_ID,
      groupId: GROUP_A,
      caseStudyId: CASE_ONE,
      presentationDate: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    });

    // Releasing now would leave an assignment for a case the group no longer
    // holds, with whatever they have already handed in under it.
    await expect(
      releaseClaim(lecturer, CLASS_ID, CASE_ONE, 'Trying to undo it after the fact.'),
    ).rejects.toThrow(/claimAlreadyScheduled/);
  });

  it('marks a claim as scheduled when the assignment is created', async () => {
    await claimCase(inA, CLASS_ID, CASE_ONE);
    const assignmentId = await createAssignment(lecturer, {
      classId: CLASS_ID,
      groupId: GROUP_A,
      caseStudyId: CASE_ONE,
      presentationDate: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    });

    expect((await listClaims(CLASS_ID))[0]?.assignmentId).toBe(assignmentId);
  });

  it('needs a reason worth keeping', async () => {
    await claimCase(inA, CLASS_ID, CASE_ONE);
    await expect(releaseClaim(lecturer, CLASS_ID, CASE_ONE, 'x')).rejects.toThrow(/reasonRequired/);
  });

  it('turning self-selection off leaves existing choices alone', async () => {
    await claimCase(inA, CLASS_ID, CASE_ONE);
    await setCaseSelection(lecturer, CLASS_ID, 'lecturer_assigns', null);

    // The lecturer is taking the decision back, not throwing away a week of
    // the groups' reading.
    expect(await listClaims(CLASS_ID)).toHaveLength(1);
  });
});

describe('several groups on one case', () => {
  it('lets as many groups take a case as the lecturer allows, each on a place of its own', async () => {
    await seedClass('groups_choose', undefined, { groupsPerCase: 2 });

    const first = await claimCase(inA, CLASS_ID, CASE_ONE);
    const second = await claimCase(inB, CLASS_ID, CASE_ONE);

    expect(first.id).toBe(caseClaimId(CLASS_ID, CASE_ONE, 1));
    expect(second.id).toBe(caseClaimId(CLASS_ID, CASE_ONE, 2));
    await expect(claimCase(inC, CLASS_ID, CASE_ONE)).rejects.toThrow(/caseFull/);
  });

  it('gives two places to exactly two of three groups pressing at once', async () => {
    await seedClass('groups_choose', undefined, { groupsPerCase: 2 });

    const results = await Promise.allSettled([
      claimCase(inA, CLASS_ID, CASE_ONE),
      claimCase(inB, CLASS_ID, CASE_ONE),
      claimCase(inC, CLASS_ID, CASE_ONE),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    const slots = (await listClaims(CLASS_ID)).map((claim) => claim.slot).sort();
    expect(slots).toEqual([1, 2]);
  });

  it('shows the group the places left and who holds the others', async () => {
    await seedClass('groups_choose', undefined, { groupsPerCase: 2 });
    await claimCase(inA, CLASS_ID, CASE_ONE);

    const row = (await choosableCases(CLASS_ID)).cases.find((item) => item.study.id === CASE_ONE);
    expect(row?.capacity).toBe(2);
    expect(row?.claims.map((claim) => claim.groupId)).toEqual([GROUP_A]);
  });

  it('asks which group when two share the case being released', async () => {
    await seedClass('groups_choose', undefined, { groupsPerCase: 2 });
    await claimCase(inA, CLASS_ID, CASE_ONE);
    await claimCase(inB, CLASS_ID, CASE_ONE);

    await expect(
      releaseClaim(lecturer, CLASS_ID, CASE_ONE, 'Swapping one group out.'),
    ).rejects.toThrow(/claimAmbiguous/);

    await releaseClaim(lecturer, CLASS_ID, CASE_ONE, 'Swapping one group out.', GROUP_A);
    const left = await listClaims(CLASS_ID);
    expect(left.map((claim) => claim.groupId)).toEqual([GROUP_B]);

    // The freed first place is the one a third group now gets.
    const third = await claimCase(inC, CLASS_ID, CASE_ONE);
    expect(third.slot).toBe(1);
  });

  it('marks the claim of the group the assignment was set for, not its neighbour', async () => {
    await seedClass('groups_choose', undefined, { groupsPerCase: 2 });
    await claimCase(inA, CLASS_ID, CASE_ONE);
    await claimCase(inB, CLASS_ID, CASE_ONE);

    const assignmentId = await createAssignment(lecturer, {
      classId: CLASS_ID,
      groupId: GROUP_B,
      caseStudyId: CASE_ONE,
      presentationDate: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    });

    const claims = await listClaims(CLASS_ID);
    expect(claims.find((claim) => claim.groupId === GROUP_B)?.assignmentId).toBe(assignmentId);
    expect(claims.find((claim) => claim.groupId === GROUP_A)?.assignmentId).toBeUndefined();
  });
});

describe('the class case set', () => {
  it('offers a class with no set the published cases of its own course', async () => {
    const view = await caseSetOfClass(CLASS_ID);
    expect(view.explicit).toBe(false);
    expect(view.caseIds.sort()).toEqual([CASE_ONE, CASE_TWO].sort());
  });

  it('offers exactly the set once there is one, from any course', async () => {
    await setClassCaseSet(lecturer, CLASS_ID, {
      caseSetIds: [CASE_TWO, OTHER_COURSE_CASE],
      groupsPerCase: 1,
    });

    const offered = (await choosableCases(CLASS_ID)).cases.map((row) => row.study.id).sort();
    expect(offered).toEqual([CASE_TWO, OTHER_COURSE_CASE].sort());

    await expect(claimCase(inA, CLASS_ID, CASE_ONE)).rejects.toThrow(/caseNotOffered/);
    await expect(claimCase(inA, CLASS_ID, OTHER_COURSE_CASE)).resolves.toBeTruthy();
  });

  it('will not drop a case a group has chosen', async () => {
    await claimCase(inA, CLASS_ID, CASE_ONE);
    await expect(
      setClassCaseSet(lecturer, CLASS_ID, { caseSetIds: [CASE_TWO], groupsPerCase: 1 }),
    ).rejects.toThrow(/caseInUse/);
  });

  it('will not allow fewer places than groups already hold', async () => {
    await seedClass('groups_choose', undefined, { groupsPerCase: 2 });
    await claimCase(inA, CLASS_ID, CASE_ONE);
    await claimCase(inB, CLASS_ID, CASE_ONE);

    await expect(
      setClassCaseSet(lecturer, CLASS_ID, { caseSetIds: [CASE_ONE], groupsPerCase: 1 }),
    ).rejects.toThrow(/groupsPerCaseBelowClaims/);
  });

  it('refuses a case that does not exist', async () => {
    await expect(
      setClassCaseSet(lecturer, CLASS_ID, { caseSetIds: ['no-such-case'], groupsPerCase: 1 }),
    ).rejects.toThrow(/caseNotFound/);
  });

  it('records the change, so who changed what a class works from shows', async () => {
    await setClassCaseSet(lecturer, CLASS_ID, { caseSetIds: [CASE_ONE], groupsPerCase: 3 });

    const logs = await getDb()
      .collection(COLLECTIONS.auditLogs)
      .where('actorUid', '==', lecturer.uid)
      .get();
    const entry = logs.docs
      .map((doc) => doc.data())
      .find((row) => row.action === 'class.case_set_changed');
    expect(entry?.after).toMatchObject({ caseSetIds: [CASE_ONE], groupsPerCase: 3 });
  });

  it('copies another class’s set and places to next term’s class', async () => {
    await setClassCaseSet(lecturer, CLASS_ID, {
      caseSetIds: [CASE_ONE, OTHER_COURSE_CASE],
      groupsPerCase: 2,
    });
    await seedClass('groups_choose', undefined, {}, CLASS_TWO);

    await copyCaseSet(lecturer, CLASS_TWO, CLASS_ID);

    const copied = await caseSetOfClass(CLASS_TWO);
    expect(copied.explicit).toBe(true);
    expect(copied.caseIds.sort()).toEqual([CASE_ONE, OTHER_COURSE_CASE].sort());
    expect(copied.groupsPerCase).toBe(2);
  });

  it('copies what a class without a set was offered from its course', async () => {
    await seedClass('groups_choose', undefined, {}, CLASS_TWO);
    await copyCaseSet(lecturer, CLASS_TWO, CLASS_ID);
    expect((await caseSetOfClass(CLASS_TWO)).caseIds.sort()).toEqual([CASE_ONE, CASE_TWO].sort());
  });

  it('will not copy from a class the lecturer does not teach', async () => {
    await seedClass('groups_choose', undefined, { lecturerIds: [otherLecturer.uid] }, CLASS_TWO);
    await expect(copyCaseSet(otherLecturer, CLASS_TWO, CLASS_ID)).rejects.toThrow(/notYourClass/);
  });
});

describe('a claim made before cases were checked against the course', () => {
  // Production holds one: a group took a case filed under another course while
  // nothing checked that. The class has no set yet.
  async function seedOldClaim() {
    await getDb()
      .collection(COLLECTIONS.caseClaims)
      .doc(caseClaimId(CLASS_ID, OTHER_COURSE_CASE))
      .set({
        id: caseClaimId(CLASS_ID, OTHER_COURSE_CASE),
        classId: CLASS_ID,
        caseStudyId: OTHER_COURSE_CASE,
        groupId: GROUP_A,
        claimedByUid: inA.uid,
        claimedByName: inA.uid,
        claimedAt: new Date().toISOString(),
      });
  }

  it('still shows the group the case as theirs', async () => {
    await seedOldClaim();
    const row = (await choosableCases(CLASS_ID)).cases.find(
      (item) => item.study.id === OTHER_COURSE_CASE,
    );
    expect(row?.claims.map((claim) => claim.groupId)).toEqual([GROUP_A]);
  });

  it('starts the set with that case ticked, so a first save keeps it', async () => {
    await seedOldClaim();
    const view = await caseSetOfClass(CLASS_ID);
    expect(view.caseIds).toContain(OTHER_COURSE_CASE);

    await expect(
      setClassCaseSet(lecturer, CLASS_ID, { caseSetIds: view.caseIds, groupsPerCase: 1 }),
    ).resolves.toBeUndefined();
  });
});

describe('who may read a case', () => {
  it('lets a student read the cases of their course while the class has no set', async () => {
    const one = await getCase(CASE_ONE);
    await expect(assertCanReadCase(inA, one!)).resolves.toBeUndefined();

    const other = await getCase(OTHER_COURSE_CASE);
    await expect(assertCanReadCase(inA, other!)).rejects.toThrow(/caseNotYourCourse/);
  });

  it('lets a group open the case it holds, filed under another course', async () => {
    // The CASE01 problem: a group took a case filed under a course the class
    // is not in, and could not download its own material.
    const other = await getCase(OTHER_COURSE_CASE);
    await createAssignment(lecturer, {
      classId: CLASS_ID,
      groupId: GROUP_A,
      caseStudyId: OTHER_COURSE_CASE,
      presentationDate: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    });

    await expect(assertCanReadCase(inA, other!)).resolves.toBeUndefined();
    // Their classmate in another group is not holding it.
    await expect(assertCanReadCase(inB, other!)).rejects.toThrow(/caseNotYourCourse/);
  });

  it('follows the set once the class has one', async () => {
    await setClassCaseSet(lecturer, CLASS_ID, {
      caseSetIds: [OTHER_COURSE_CASE],
      groupsPerCase: 1,
    });

    const all = await Promise.all(
      [CASE_ONE, CASE_TWO, OTHER_COURSE_CASE].map(async (id) => (await getCase(id))!),
    );
    const readable = (await filterCasesForStudent(inB.uid, all)).map((study) => study.id);
    expect(readable).toEqual([OTHER_COURSE_CASE]);
  });

  it('gives a student of another class nothing of this class’s set', async () => {
    await setClassCaseSet(lecturer, CLASS_ID, {
      caseSetIds: [OTHER_COURSE_CASE],
      groupsPerCase: 1,
    });
    await seedClass('groups_choose', undefined, { courseId: 'CS-C9' }, CLASS_TWO);
    await seedMember(outsider.uid, null, CLASS_TWO);

    const other = await getCase(OTHER_COURSE_CASE);
    await expect(assertCanReadCase(outsider, other!)).rejects.toThrow(/caseNotYourCourse/);
  });
});

describe('a deliverable handed in as a link', () => {
  const VIDEO = 'https://www.youtube.com/watch?v=abc123';

  async function seedAssignment() {
    const presentation = Date.now() + 7 * 24 * 3600_000;
    await getDb()
      .collection(COLLECTIONS.assignments)
      .doc('CS-A1')
      .set({
        id: 'CS-A1',
        classId: CLASS_ID,
        groupId: GROUP_A,
        caseStudyId: CASE_ONE,
        caseVersionId: 'v1',
        policyId: policy.id,
        policyVersion: policy.version,
        rubricVersion: policy.rubric.version,
        presentationDate: new Date(presentation).toISOString(),
        submissionDeadline: new Date(presentation - 24 * 3600_000).toISOString(),
        status: 'submission_open',
      });
  }

  it('is stored with the host a reader will see, and no bytes of ours', async () => {
    await seedAssignment();
    const submission = await submitLink(inA, GROUP_A, {
      assignmentId: 'CS-A1',
      deliverableId: 'presentation-video',
      url: VIDEO,
    });

    expect(submission.externalUrl).toBe(VIDEO);
    expect(submission.fileName).toBe('youtube.com');
    expect(submission.storagePath).toBeUndefined();
    expect(submission.versionNumber).toBe(1);
  });

  it('is versioned like a file: re-recording never overwrites', async () => {
    await seedAssignment();
    await submitLink(inA, GROUP_A, {
      assignmentId: 'CS-A1',
      deliverableId: 'presentation-video',
      url: VIDEO,
    });
    const second = await submitLink(inA, GROUP_A, {
      assignmentId: 'CS-A1',
      deliverableId: 'presentation-video',
      url: 'https://vimeo.com/999',
    });

    expect(second.versionNumber).toBe(2);
    const all = await listSubmissions('CS-A1');
    expect(all).toHaveLength(2);
    expect(all.find((row) => row.versionNumber === 1)?.status).toBe('superseded');
  });

  it('says so rather than handing back an empty file', async () => {
    await seedAssignment();
    const submission = await submitLink(inA, GROUP_A, {
      assignmentId: 'CS-A1',
      deliverableId: 'presentation-video',
      url: VIDEO,
    });

    // An empty buffer would be treated by a caller as a readable document.
    await expect(readSubmissionFile(submission.id)).rejects.toThrow(/submissionIsALink/);
  });

  it('refuses a link for a deliverable that is meant to be a file', async () => {
    await seedAssignment();
    await expect(
      submitLink(inA, GROUP_A, {
        assignmentId: 'CS-A1',
        deliverableId: 'slides-pdf',
        url: VIDEO,
      }),
    ).rejects.toThrow(/deliverableIsNotALink/);
  });

  it('refuses an address a browser should not be sent to', async () => {
    await seedAssignment();
    for (const url of ['http://youtube.com/watch', 'youtube.com', 'javascript:alert(1)']) {
      await expect(
        submitLink(inA, GROUP_A, {
          assignmentId: 'CS-A1',
          deliverableId: 'presentation-video',
          url,
        }),
      ).rejects.toThrow(/linkNotHttps/);
    }
  });

  it('records the address in the audit log, so a swap after the deadline shows', async () => {
    await seedAssignment();
    await submitLink(inA, GROUP_A, {
      assignmentId: 'CS-A1',
      deliverableId: 'presentation-video',
      url: VIDEO,
    });

    const logs = await getDb()
      .collection(COLLECTIONS.auditLogs)
      .where('actorUid', '==', inA.uid)
      .get();
    const entry = logs.docs
      .map((doc) => doc.data())
      .find((row) => row.action === 'submission.created');
    expect(entry?.after).toMatchObject({ externalUrl: VIDEO });
  });

  it('refuses a group handing in against somebody else’s assignment', async () => {
    await seedAssignment();
    await expect(
      submitLink(inB, GROUP_B, {
        assignmentId: 'CS-A1',
        deliverableId: 'presentation-video',
        url: VIDEO,
      }),
    ).rejects.toThrow(/notYourAssignment/);
  });
});

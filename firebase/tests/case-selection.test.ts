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
} = await import('@casestudyhub/core');
const { COLLECTIONS, DEFAULT_PRESENTATION_POLICY, caseClaimId } =
  await import('@casestudyhub/shared');

const CLASS_ID = 'CS-A01';
const GROUP_A = 'CS-G1';
const GROUP_B = 'CS-G2';
const CASE_ONE = 'CS-CASE1';
const CASE_TWO = 'CS-CASE2';
const DRAFT_CASE = 'CS-CASE3';

const policy = DEFAULT_PRESENTATION_POLICY;
const lecturer = { uid: 'cs_lecturer', email: 'gv@x.edu.vn', role: 'lecturer' as const };
const inA = { uid: 'cs_student_a', email: 'a@x.edu.vn', role: 'student' as const };
const inB = { uid: 'cs_student_b', email: 'b@x.edu.vn', role: 'student' as const };
const grouplesss = { uid: 'cs_student_c', email: 'c@x.edu.vn', role: 'student' as const };
const outsider = { uid: 'cs_outsider', email: 'o@x.edu.vn', role: 'student' as const };

async function seedClass(caseSelection: 'lecturer_assigns' | 'groups_choose', deadline?: string) {
  await getDb()
    .collection(COLLECTIONS.classes)
    .doc(CLASS_ID)
    .set({
      id: CLASS_ID,
      classCode: 'CS01',
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
      status: 'active',
    });
}

async function seedCase(caseId: string, title: string, status: 'published' | 'draft') {
  await getDb().collection(COLLECTIONS.caseStudies).doc(caseId).set({
    id: caseId,
    caseCode: caseId,
    title,
    courseId: 'CS-C1',
    language: 'vi',
    status,
    currentVersionId: 'v1',
  });
}

async function seedMember(uid: string, groupId: string | null) {
  const db = getDb();
  await db
    .collection(COLLECTIONS.classEnrollments)
    .doc(`${CLASS_ID}__${uid}`)
    .set({
      id: `${CLASS_ID}__${uid}`,
      classId: CLASS_ID,
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
    .doc(`${CLASS_ID}__${uid}`)
    .set({
      id: `${CLASS_ID}__${uid}`,
      classId: CLASS_ID,
      groupId,
      studentUid: uid,
      studentId: uid.toUpperCase(),
      fullName: uid,
      roleIds: [],
      isLeader: false,
    });
}

async function seedGroup(groupId: string, groupName: string) {
  await getDb().collection(COLLECTIONS.groups).doc(groupId).set({
    id: groupId,
    groupCode: groupId,
    groupName,
    classId: CLASS_ID,
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
    db.collection(COLLECTIONS.caseClaims).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.classEnrollments).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.groupMembers).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.groups).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.assignments).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.submissions).where('assignmentId', '==', 'CS-A1').get(),
    db.collection(COLLECTIONS.caseStudies).where('courseId', '==', 'CS-C1').get(),
  ];
  for (const snapshot of await Promise.all(jobs)) {
    await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
  }
  await db.collection(COLLECTIONS.classes).doc(CLASS_ID).delete();
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
  await seedMember(inA.uid, GROUP_A);
  await seedMember(inB.uid, GROUP_B);
  await seedMember(grouplesss.uid, null);
  await seedCase(CASE_ONE, 'Amazon', 'published');
  await seedCase(CASE_TWO, 'Walmart', 'published');
  await seedCase(DRAFT_CASE, 'Chua cong bo', 'draft');
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

    expect(taken?.claim?.groupId).toBe(GROUP_A);
    expect(free?.claim).toBeNull();
    // A draft case is offered to nobody.
    expect(state.cases.some((row) => row.study.id === DRAFT_CASE)).toBe(false);
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

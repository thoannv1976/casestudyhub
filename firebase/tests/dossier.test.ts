import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * The presentation dossier, against the real database.
 *
 * Nothing here is newly stored, so what is worth proving is that the gathering
 * is honest: the lecturer sees the name behind an anonymous question, sees
 * which group each scorer belongs to, and gets an empty dossier rather than an
 * error for a group that never presented.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const { getDb, presentationDossier } = await import('@casestudyhub/core');
const { COLLECTIONS, DEFAULT_PRESENTATION_POLICY } = await import('@casestudyhub/shared');

const CLASS_ID = 'DOS-A01';
const PRESENTING = 'DOS-G1';
const AUDIENCE = 'DOS-G2';
const ASSIGNMENT_ID = 'DOS-A1';
const SESSION_ID = 'DOS-S1';
const CASE_ID = 'DOS-CS1';

const policy = DEFAULT_PRESENTATION_POLICY;
const HOUR = 3_600_000;

async function seedAll({ withSession = true }: { withSession?: boolean } = {}) {
  const db = getDb();
  const presentation = Date.now() + 24 * HOUR;

  await db.collection(COLLECTIONS.caseStudies).doc(CASE_ID).set({
    id: CASE_ID,
    caseCode: 'DOS-CS1',
    title: 'Amazon',
    courseId: 'DOS-C1',
    language: 'en',
    status: 'published',
  });

  await db
    .collection(COLLECTIONS.assignments)
    .doc(ASSIGNMENT_ID)
    .set({
      id: ASSIGNMENT_ID,
      classId: CLASS_ID,
      groupId: PRESENTING,
      caseStudyId: CASE_ID,
      caseVersionId: 'v1',
      policyId: policy.id,
      policyVersion: policy.version,
      rubricVersion: policy.rubric.version,
      presentationDate: new Date(presentation).toISOString(),
      submissionDeadline: new Date(presentation - 24 * HOUR).toISOString(),
      status: 'under_review',
    });

  for (const [id, name] of [
    [PRESENTING, 'Nhom 1'],
    [AUDIENCE, 'Nhom 2'],
  ] as const) {
    await db.collection(COLLECTIONS.groups).doc(id).set({
      id,
      groupCode: id,
      groupName: name,
      classId: CLASS_ID,
      maxMembers: 5,
      memberCount: 2,
      formationMode: 'lecturer_assignment',
      locked: false,
      status: 'forming',
    });
  }

  for (const [uid, groupId, fullName] of [
    ['dos_p1', PRESENTING, 'Presenter One'],
    ['dos_p2', PRESENTING, 'Presenter Two'],
    ['dos_a1', AUDIENCE, 'Audience One'],
    ['dos_a2', AUDIENCE, 'Audience Two'],
  ] as const) {
    await db
      .collection(COLLECTIONS.groupMembers)
      .doc(`${CLASS_ID}__${uid}`)
      .set({
        id: `${CLASS_ID}__${uid}`,
        classId: CLASS_ID,
        groupId,
        studentUid: uid,
        studentId: uid.toUpperCase(),
        fullName,
        roleIds: [],
        isLeader: false,
      });
  }

  if (!withSession) return;

  await db.collection(COLLECTIONS.presentationSessions).doc(SESSION_ID).set({
    id: SESSION_ID,
    classId: CLASS_ID,
    assignmentId: ASSIGNMENT_ID,
    groupId: PRESENTING,
    caseStudyId: CASE_ID,
    status: 'completed',
    currentRoleId: null,
    runningSinceMs: null,
    accumulatedMs: 0,
    roleMs: {},
    questionsOpen: false,
    peerReviewOpen: false,
  });
}

async function seedQuestion(
  uid: string,
  text: string,
  options: { anonymous?: boolean; answered?: boolean; upvotes?: number; roleId?: string } = {},
) {
  await getDb()
    .collection(COLLECTIONS.questions)
    .doc(`${SESSION_ID}__${uid}`)
    .set({
      id: `${SESSION_ID}__${uid}`,
      caseStudyId: CASE_ID,
      sessionId: SESSION_ID,
      classId: CLASS_ID,
      groupId: PRESENTING,
      askedByUid: uid,
      askedByName: uid === 'dos_a1' ? 'Audience One' : 'Audience Two',
      askedByStudentId: uid.toUpperCase(),
      anonymousToClass: options.anonymous ?? true,
      roleId: options.roleId ?? null,
      category: 'clarification',
      text,
      upvotes: options.upvotes ?? 0,
      status: options.answered ? 'answered' : 'submitted',
      ...(options.answered ? { answerText: 'Answered on the day.' } : {}),
    });
}

async function seedPeerReview(uid: string, groupId: string, total: number) {
  const scores = Object.fromEntries(
    policy.rubric.criteria.map((criterion) => [
      criterion.id,
      Math.round((total / policy.rubric.totalPoints) * criterion.maxPoints),
    ]),
  );

  await getDb()
    .collection(COLLECTIONS.peerReviews)
    .doc(`${SESSION_ID}__${uid}`)
    .set({
      id: `${SESSION_ID}__${uid}`,
      sessionId: SESSION_ID,
      classId: CLASS_ID,
      caseStudyId: CASE_ID,
      groupId: PRESENTING,
      reviewerUid: uid,
      reviewerName: uid === 'dos_a1' ? 'Audience One' : 'Audience Two',
      reviewerStudentId: uid.toUpperCase(),
      reviewerGroupId: groupId,
      scores,
      total: Object.values(scores).reduce((sum, value) => sum + value, 0),
      comment: `Comment from ${uid}`,
      rubricId: policy.rubric.id,
      rubricVersion: policy.rubric.version,
      submittedAt: new Date().toISOString(),
    });
}

async function seedResponder(uid: string) {
  await getDb()
    .collection(COLLECTIONS.questionResponses)
    .doc(`${SESSION_ID}__${uid}`)
    .set({
      id: `${SESSION_ID}__${uid}`,
      sessionId: SESSION_ID,
      questionId: `${SESSION_ID}__dos_a1`,
      responderUid: uid,
      roleId: 'R1',
      answeredAt: new Date().toISOString(),
    });
}

async function wipe() {
  const db = getDb();
  const jobs = [
    db.collection(COLLECTIONS.assignments).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.groups).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.groupMembers).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.presentationSessions).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.questions).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.peerReviews).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.questionResponses).where('sessionId', '==', SESSION_ID).get(),
    db.collection(COLLECTIONS.caseStudies).where('id', '==', CASE_ID).get(),
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

describe('the questions the class asked', () => {
  it('shows the lecturer the name behind an anonymous question', async () => {
    await seedAll();
    await seedQuestion('dos_a1', 'Which part of the journey does Amazon control?', {
      anonymous: true,
    });

    const dossier = await presentationDossier(ASSIGNMENT_ID);
    const question = dossier.questions[0];

    // The class never saw this. The lecturer settling a dispute always could.
    expect(question?.anonymousToClass).toBe(true);
    expect(question?.askedByName).toBe('Audience One');
    expect(question?.askedByStudentId).toBe('DOS_A1');
  });

  it('puts the most upvoted question first', async () => {
    await seedAll();
    await seedQuestion('dos_a1', 'The quieter question.', { upvotes: 1 });
    await seedQuestion('dos_a2', 'The question the room wanted.', { upvotes: 9 });

    const dossier = await presentationDossier(ASSIGNMENT_ID);
    expect(dossier.questions[0]?.upvotes).toBe(9);
  });

  it('counts the ones answered aloud, which the Guide asks the group to do', async () => {
    await seedAll();
    await seedQuestion('dos_a1', 'Answered on the day.', { answered: true });
    await seedQuestion('dos_a2', 'Never got to this one.', { answered: false });

    const dossier = await presentationDossier(ASSIGNMENT_ID);
    expect(dossier.questions).toHaveLength(2);
    expect(dossier.answeredAloud).toBe(1);
  });

  it('names the presenters who answered nothing at all', async () => {
    await seedAll();
    await seedQuestion('dos_a1', 'Somebody had to answer this.', { answered: true });
    await seedResponder('dos_p1');

    const dossier = await presentationDossier(ASSIGNMENT_ID);
    // A proportion tells a lecturer the group was quiet; a name tells them who
    // to ask next time.
    expect(dossier.presentersWhoAnsweredNothing).toEqual(['Presenter Two']);
  });
});

describe('the scores the class gave', () => {
  it('names the group each scorer belongs to', async () => {
    await seedAll();
    await seedPeerReview('dos_a1', AUDIENCE, 90);
    await seedPeerReview('dos_a2', AUDIENCE, 40);

    const dossier = await presentationDossier(ASSIGNMENT_ID);
    // A group marking a rival down shows here and nowhere else.
    expect(dossier.reviews.every((review) => review.reviewerGroupName === 'Nhom 2')).toBe(true);
  });

  it('puts the highest score first and keeps every comment', async () => {
    await seedAll();
    await seedPeerReview('dos_a1', AUDIENCE, 90);
    await seedPeerReview('dos_a2', AUDIENCE, 40);

    const dossier = await presentationDossier(ASSIGNMENT_ID);
    expect(dossier.reviews[0]?.total).toBeGreaterThan(dossier.reviews[1]?.total ?? 0);
    expect(dossier.reviews.map((review) => review.comment)).toEqual([
      'Comment from dos_a1',
      'Comment from dos_a2',
    ]);
  });

  it('says how many of those who could score did', async () => {
    await seedAll();
    await seedPeerReview('dos_a1', AUDIENCE, 80);

    const dossier = await presentationDossier(ASSIGNMENT_ID);
    // The presenting group cannot score itself, so it is not eligible.
    expect(dossier.eligibleScorers).toBe(2);
    expect(dossier.summary.count).toBe(1);
  });

  it('reports mean and median side by side, as the room is read', async () => {
    await seedAll();
    await seedPeerReview('dos_a1', AUDIENCE, 90);
    await seedPeerReview('dos_a2', AUDIENCE, 20);

    const dossier = await presentationDossier(ASSIGNMENT_ID);
    expect(dossier.summary.mean).toBeGreaterThan(0);
    expect(dossier.summary.lowest).toBeLessThan(dossier.summary.highest);
  });
});

describe('a group that never presented', () => {
  it('gets an empty dossier rather than an error', async () => {
    await seedAll({ withSession: false });

    const dossier = await presentationDossier(ASSIGNMENT_ID);
    expect(dossier.sessionId).toBeNull();
    expect(dossier.questions).toHaveLength(0);
    expect(dossier.reviews).toHaveLength(0);
    // And the group is still named, so the page reads sensibly.
    expect(dossier.groupName).toBe('Nhom 1');
    expect(dossier.caseTitle).toBe('Amazon');
  });

  it('refuses an assignment that does not exist', async () => {
    await expect(presentationDossier('no-such-assignment')).rejects.toThrow(/assignmentNotFound/);
  });
});

describe('the framework the dossier reads by', () => {
  it('is the version the assignment froze, not today’s', async () => {
    await seedAll();
    const dossier = await presentationDossier(ASSIGNMENT_ID);

    expect(dossier.policy.version).toBe(policy.version);
    expect(dossier.policy.rubric.criteria).toHaveLength(policy.rubric.criteria.length);
  });
});

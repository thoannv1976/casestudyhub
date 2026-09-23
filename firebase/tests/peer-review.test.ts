import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Peer assessment against the real database.
 *
 * The rule that matters most here is not a permission but a promise: a peer
 * score is evidence the lecturer reads, never arithmetic that moves a mark.
 * The last test in this file is the one that keeps that promise honest.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const { getDb, submitPeerReview, listPeerReviews, getOwnPeerReview, peerReviewId } =
  await import('@casestudyhub/core');
const { COLLECTIONS, DEFAULT_PRESENTATION_POLICY, summarisePeerReviews } =
  await import('@casestudyhub/shared');

const CLASS_ID = 'PEER-A01';
const SESSION_ID = 'PEER-PS1';
const PRESENTING_GROUP = 'PEER-G1';
const AUDIENCE_GROUP = 'PEER-G2';

const rubric = DEFAULT_PRESENTATION_POLICY.rubric;
const full = (fraction: number) =>
  Object.fromEntries(
    rubric.criteria.map((criterion) => [criterion.id, criterion.maxPoints * fraction]),
  );

function student(index: number) {
  return {
    session: { uid: `peer_uid_${index}`, email: `sv${index}@x.edu.vn`, role: 'student' as const },
    profile: { fullName: `Student ${index}`, studentId: `SV${String(index).padStart(3, '0')}` },
  };
}

async function seedSession(overrides: Record<string, unknown> = {}) {
  await getDb()
    .collection(COLLECTIONS.presentationSessions)
    .doc(SESSION_ID)
    .set({
      id: SESSION_ID,
      classId: CLASS_ID,
      assignmentId: 'PEER-A1',
      groupId: PRESENTING_GROUP,
      caseStudyId: 'PEER-CS1',
      status: 'review',
      currentRoleId: null,
      runningSinceMs: null,
      accumulatedMs: 0,
      roleMs: {},
      questionsOpen: false,
      peerReviewOpen: true,
      ...overrides,
    });
}

async function seedMembership(uid: string, groupId: string) {
  await getDb()
    .collection(COLLECTIONS.groupMembers)
    .doc(`${CLASS_ID}__${uid}`)
    .set({
      id: `${CLASS_ID}__${uid}`,
      groupId,
      classId: CLASS_ID,
      studentUid: uid,
      studentId: uid.toUpperCase(),
      fullName: uid,
      roleIds: [],
      isLeader: false,
    });
}

async function wipe() {
  const db = getDb();
  for (const [collection, field] of [
    [COLLECTIONS.presentationSessions, 'classId'],
    [COLLECTIONS.peerReviews, 'classId'],
    [COLLECTIONS.groupMembers, 'classId'],
  ] as const) {
    const snapshot = await db.collection(collection).where(field, '==', CLASS_ID).get();
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

describe('scoring the group that presented', () => {
  it('records one score per student and totals it against the rubric', async () => {
    await seedSession();
    const { session, profile } = student(1);
    await seedMembership(session.uid, AUDIENCE_GROUP);

    const review = await submitPeerReview(session, SESSION_ID, profile, { scores: full(0.8) });

    expect(review.total).toBeCloseTo(80, 6);
    expect(review.id).toBe(peerReviewId(SESSION_ID, session.uid));
    expect(review.groupId).toBe(PRESENTING_GROUP);
    expect(review.reviewerGroupId).toBe(AUDIENCE_GROUP);
    // Frozen with the review, so a later rubric version cannot rewrite it.
    expect(review.rubricVersion).toBe(rubric.version);
  });

  it('replaces an earlier score rather than counting it twice', async () => {
    await seedSession();
    const { session, profile } = student(2);
    await seedMembership(session.uid, AUDIENCE_GROUP);

    await submitPeerReview(session, SESSION_ID, profile, { scores: full(0.5) });
    await submitPeerReview(session, SESSION_ID, profile, {
      scores: full(0.9),
      comment: 'Better than I first thought once they answered the data question.',
    });

    const reviews = await listPeerReviews(SESSION_ID);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.total).toBeCloseTo(90, 6);
    expect(reviews[0]?.comment).toContain('data question');
  });

  it('refuses a group scoring itself', async () => {
    await seedSession();
    const { session, profile } = student(3);
    await seedMembership(session.uid, PRESENTING_GROUP);

    await expect(
      submitPeerReview(session, SESSION_ID, profile, { scores: full(1) }),
    ).rejects.toThrow(/cannotReviewOwnGroup/);
  });

  it('refuses a score while the window is shut', async () => {
    await seedSession({ peerReviewOpen: false });
    const { session, profile } = student(4);

    await expect(
      submitPeerReview(session, SESSION_ID, profile, { scores: full(1) }),
    ).rejects.toThrow(/peerReviewClosed/);
  });

  it('refuses a score above what a criterion is worth', async () => {
    await seedSession();
    const { session, profile } = student(5);

    await expect(
      submitPeerReview(session, SESSION_ID, profile, {
        scores: { ...full(1), delivery: 50 },
      }),
    ).rejects.toThrow(/peerScoreOutOfRange/);
  });

  it('gives a student back their own score and no one else’s', async () => {
    await seedSession();
    const mine = student(6);
    const theirs = student(7);
    await submitPeerReview(mine.session, SESSION_ID, mine.profile, { scores: full(0.7) });
    await submitPeerReview(theirs.session, SESSION_ID, theirs.profile, { scores: full(0.3) });

    const own = await getOwnPeerReview(SESSION_ID, mine.session.uid);
    expect(own?.total).toBeCloseTo(70, 6);
    expect(own?.reviewerUid).toBe(mine.session.uid);
  });
});

describe('the promise that a peer score is evidence, not arithmetic', () => {
  it('writes nothing to the grades collection, however many scores arrive', async () => {
    await seedSession();

    for (const index of [10, 11, 12, 13, 14]) {
      const { session, profile } = student(index);
      await submitPeerReview(session, SESSION_ID, profile, { scores: full(0.6) });
    }

    const reviews = await listPeerReviews(SESSION_ID);
    expect(reviews).toHaveLength(5);

    // The lecturer gets a distribution to read...
    const summary = summarisePeerReviews(reviews, rubric);
    expect(summary.count).toBe(5);
    expect(summary.mean).toBeCloseTo(60, 6);

    // ...and nothing at all has been graded.
    const grades = await getDb()
      .collection(COLLECTIONS.grades)
      .where('groupId', '==', PRESENTING_GROUP)
      .get();
    expect(grades.empty).toBe(true);
  });
});

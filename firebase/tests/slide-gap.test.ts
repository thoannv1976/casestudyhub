import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * The one gap in the submission wall, checked constraint by constraint.
 *
 * Until now every submitted file was private to the group that handed it in.
 * A class watching a presentation needs the slide deck on their own screen,
 * so exactly one thing opens: the PDF slide deck, of the group whose session
 * has started, to that class. This file exists because a gap like that is
 * easy to widen by accident, and hard to notice once widened.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const { getDb, classMayViewSubmission, CLASS_VISIBLE_DELIVERABLE_ID } =
  await import('@casestudyhub/core');
const { COLLECTIONS, DEFAULT_PRESENTATION_POLICY } = await import('@casestudyhub/shared');

const CLASS_ID = 'GAP-A01';
const ASSIGNMENT_ID = 'GAP-A1';
const OTHER_ASSIGNMENT_ID = 'GAP-A2';

async function seedSession(status: string) {
  await getDb().collection(COLLECTIONS.presentationSessions).doc('GAP-PS1').set({
    id: 'GAP-PS1',
    classId: CLASS_ID,
    assignmentId: ASSIGNMENT_ID,
    groupId: 'GAP-G1',
    caseStudyId: 'GAP-CS1',
    status,
    currentRoleId: 'R1',
    runningSinceMs: null,
    accumulatedMs: 0,
    roleMs: {},
    questionsOpen: true,
    peerReviewOpen: false,
  });
}

async function wipe() {
  const snapshot = await getDb()
    .collection(COLLECTIONS.presentationSessions)
    .where('classId', '==', CLASS_ID)
    .get();
  await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('These tests must run against the emulator, never a real project.');
  }
});

beforeEach(wipe);
afterAll(wipe);

describe('the slide gap', () => {
  it('opens the slide deck once the session has started, to that class', async () => {
    await seedSession('live');

    const decision = await classMayViewSubmission({
      assignmentId: ASSIGNMENT_ID,
      deliverableId: CLASS_VISIBLE_DELIVERABLE_ID,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.classId).toBe(CLASS_ID);
  });

  it('stays open through the Q&A and after the session ends', async () => {
    // The class keeps referring back to the slides while asking, and the
    // question bank outlives the presentation.
    for (const status of ['qa', 'review', 'completed']) {
      await seedSession(status);
      const decision = await classMayViewSubmission({
        assignmentId: ASSIGNMENT_ID,
        deliverableId: CLASS_VISIBLE_DELIVERABLE_ID,
      });
      expect(decision.allowed, `status ${status}`).toBe(true);
    }
  });

  it('stays shut before the group takes the floor', async () => {
    await seedSession('scheduled');

    const decision = await classMayViewSubmission({
      assignmentId: ASSIGNMENT_ID,
      deliverableId: CLASS_VISIBLE_DELIVERABLE_ID,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.classId).toBeUndefined();
  });

  it('stays shut when no session exists at all', async () => {
    const decision = await classMayViewSubmission({
      assignmentId: ASSIGNMENT_ID,
      deliverableId: CLASS_VISIBLE_DELIVERABLE_ID,
    });

    expect(decision.allowed).toBe(false);
  });

  it('does not reach any other deliverable, whatever the session is doing', async () => {
    await seedSession('live');

    const others = DEFAULT_PRESENTATION_POLICY.deliverables
      .map((deliverable) => deliverable.id)
      .filter((id) => id !== CLASS_VISIBLE_DELIVERABLE_ID);

    // The analysis report, the role allocation sheet, the AI disclosure, the
    // reference list and the editable slide source all stay private.
    expect(others.length).toBeGreaterThan(3);
    for (const deliverableId of others) {
      const decision = await classMayViewSubmission({
        assignmentId: ASSIGNMENT_ID,
        deliverableId,
      });
      expect(decision.allowed, deliverableId).toBe(false);
    }
  });

  it('does not open one group’s slides because another group is presenting', async () => {
    await seedSession('live');

    const decision = await classMayViewSubmission({
      assignmentId: OTHER_ASSIGNMENT_ID,
      deliverableId: CLASS_VISIBLE_DELIVERABLE_ID,
    });

    expect(decision.allowed).toBe(false);
  });

  it('names the class, so the caller still has to check the viewer belongs to it', async () => {
    await seedSession('live');

    const decision = await classMayViewSubmission({
      assignmentId: ASSIGNMENT_ID,
      deliverableId: CLASS_VISIBLE_DELIVERABLE_ID,
    });

    // `allowed` alone is not permission: the route handler compares this class
    // against the classes the student is enrolled in.
    expect(decision.classId).toBe(CLASS_ID);
    expect(decision.classId).not.toBe('some-other-class');
  });
});

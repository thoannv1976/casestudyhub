import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * The question wall under the load of a real room.
 *
 * Fifty students press send within the same minute, several of them twice, and
 * the presenting group taps three questions at once. Neither the "one question
 * per student" rule nor the cap of three chosen questions can be expressed in
 * Security Rules; both live in Firestore transactions and document ids, which
 * is what these tests exercise.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const {
  getDb,
  askQuestion,
  listSessionQuestions,
  questionId,
  selectQuestion,
  toggleUpvote,
  votesOf,
} = await import('@casestudyhub/core');
const { COLLECTIONS, MAX_SELECTED_QUESTIONS } = await import('@casestudyhub/shared');

const CLASS_ID = 'QWALL-A01';
const SESSION_ID = 'QWALL-PS1';
const PRESENTING_GROUP = 'QWALL-G1';
const AUDIENCE_GROUP = 'QWALL-G2';

const lecturer = { uid: 'qwall_lecturer', email: 'gv@x.edu.vn', role: 'lecturer' as const };

function student(index: number) {
  return {
    session: { uid: `qwall_uid_${index}`, email: `sv${index}@x.edu.vn`, role: 'student' as const },
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
      assignmentId: 'QWALL-A1',
      groupId: PRESENTING_GROUP,
      caseStudyId: 'QWALL-CS1',
      status: 'live',
      currentRoleId: 'R1',
      runningSinceMs: Date.now(),
      accumulatedMs: 0,
      roleMs: {},
      questionsOpen: true,
      peerReviewOpen: false,
      ...overrides,
    });
}

/** Puts a student in a group, the way the class page would have done. */
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
  for (const [collection, field, value] of [
    [COLLECTIONS.presentationSessions, 'classId', CLASS_ID],
    [COLLECTIONS.questions, 'classId', CLASS_ID],
    [COLLECTIONS.groupMembers, 'classId', CLASS_ID],
    [COLLECTIONS.questionVotes, 'questionId', null],
  ] as const) {
    const query =
      value === null
        ? db.collection(collection)
        : db.collection(collection).where(field, '==', value);
    const snapshot = await query.get();
    await Promise.all(
      snapshot.docs
        .filter(
          (doc) => value !== null || String(doc.get('questionId') ?? '').startsWith(SESSION_ID),
        )
        .map((doc) => doc.ref.delete()),
    );
  }
}

const text = (index: number) => `Question number ${index}: which figure supports that claim?`;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('These tests must run against the emulator, never a real project.');
  }
});

beforeEach(wipe);
afterAll(wipe);

describe('a whole class asking at once', () => {
  it('keeps one question per student however many times they press send', async () => {
    await seedSession();

    // Fifty students, each pressing send twice, as happens on a phone.
    const asks = Array.from({ length: 50 }, (_, index) => index + 1).flatMap((index) => {
      const { session, profile } = student(index);
      const input = { category: 'evidence' as const, text: text(index), roleId: null };
      return [
        askQuestion(session, SESSION_ID, profile, input),
        askQuestion(session, SESSION_ID, profile, input),
      ];
    });
    await Promise.allSettled(asks);

    const questions = await listSessionQuestions(SESSION_ID);
    expect(questions).toHaveLength(50);
    expect(new Set(questions.map((question) => question.askedByUid)).size).toBe(50);
    expect(
      questions.every((question) => question.id === questionId(SESSION_ID, question.askedByUid)),
    ).toBe(true);
  });

  it('files every question under the case study, not only the session', async () => {
    await seedSession();
    const { session, profile } = student(1);
    await askQuestion(session, SESSION_ID, profile, {
      category: 'critical',
      text: text(1),
      roleId: 'R4',
    });

    const [stored] = await listSessionQuestions(SESSION_ID);
    // This is what lets a later class read the bank a previous class built.
    expect(stored?.caseStudyId).toBe('QWALL-CS1');
  });

  it('refuses a question from the group that is presenting', async () => {
    await seedSession();
    const { session, profile } = student(1);
    await seedMembership(session.uid, PRESENTING_GROUP);

    await expect(
      askQuestion(session, SESSION_ID, profile, {
        category: 'evidence',
        text: text(1),
        roleId: null,
      }),
    ).rejects.toThrow(/cannotQuestionOwnGroup/);
  });

  it('accepts a question from a student in another group', async () => {
    await seedSession();
    const { session, profile } = student(2);
    await seedMembership(session.uid, AUDIENCE_GROUP);

    await askQuestion(session, SESSION_ID, profile, {
      category: 'evidence',
      text: text(2),
      roleId: null,
    });
    expect(await listSessionQuestions(SESSION_ID)).toHaveLength(1);
  });

  it('refuses every question once the window is closed', async () => {
    await seedSession({ questionsOpen: false });
    const { session, profile } = student(3);

    await expect(
      askQuestion(session, SESSION_ID, profile, {
        category: 'evidence',
        text: text(3),
        roleId: null,
      }),
    ).rejects.toThrow(/questionsClosed/);
  });
});

describe('editing a question', () => {
  it('rewrites the same document rather than adding a second one', async () => {
    await seedSession();
    const { session, profile } = student(4);
    const input = { category: 'evidence' as const, roleId: null };

    await askQuestion(session, SESSION_ID, profile, { ...input, text: text(4) });
    await askQuestion(session, SESSION_ID, profile, {
      ...input,
      text: 'A better version of the question.',
    });

    const questions = await listSessionQuestions(SESSION_ID);
    expect(questions).toHaveLength(1);
    expect(questions[0]?.text).toBe('A better version of the question.');
  });

  it('stops once the group has chosen it, so the group is not answering a moving target', async () => {
    await seedSession();
    const { session, profile } = student(5);
    const input = { category: 'evidence' as const, roleId: null };

    const asked = await askQuestion(session, SESSION_ID, profile, { ...input, text: text(5) });
    await selectQuestion(lecturer, asked.id, true);

    await expect(
      askQuestion(session, SESSION_ID, profile, { ...input, text: 'Changed after being chosen.' }),
    ).rejects.toThrow(/questionAlreadySelected/);
  });
});

describe('the group choosing what to answer aloud', () => {
  it('stops at the cap even when several are tapped at the same moment', async () => {
    await seedSession();

    const asked = await Promise.all(
      [10, 11, 12, 13, 14].map(async (index) => {
        const { session, profile } = student(index);
        return askQuestion(session, SESSION_ID, profile, {
          category: 'evidence',
          text: text(index),
          roleId: null,
        });
      }),
    );

    const results = await Promise.allSettled(
      asked.map((question) => selectQuestion(lecturer, question.id, true)),
    );
    const chosen = (await listSessionQuestions(SESSION_ID)).filter(
      (question) => question.status === 'selected',
    );

    expect(chosen).toHaveLength(MAX_SELECTED_QUESTIONS);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(
      asked.length - MAX_SELECTED_QUESTIONS,
    );
  });

  it('frees a slot when the group changes its mind', async () => {
    await seedSession();

    const asked = await Promise.all(
      [20, 21, 22, 23].map(async (index) => {
        const { session, profile } = student(index);
        return askQuestion(session, SESSION_ID, profile, {
          category: 'evidence',
          text: text(index),
          roleId: null,
        });
      }),
    );

    for (const question of asked.slice(0, MAX_SELECTED_QUESTIONS)) {
      await selectQuestion(lecturer, question.id, true);
    }
    const fourth = asked[MAX_SELECTED_QUESTIONS];
    if (!fourth) throw new Error('expected a fourth question');

    await expect(selectQuestion(lecturer, fourth.id, true)).rejects.toThrow(/tooManySelected/);
    await selectQuestion(lecturer, asked[0]!.id, false);
    await selectQuestion(lecturer, fourth.id, true);

    const chosen = (await listSessionQuestions(SESSION_ID)).filter(
      (question) => question.status === 'selected',
    );
    expect(chosen).toHaveLength(MAX_SELECTED_QUESTIONS);
  });
});

describe('upvotes', () => {
  it('counts one vote per person however fast they tap', async () => {
    await seedSession();
    const author = student(30);
    const asked = await askQuestion(author.session, SESSION_ID, author.profile, {
      category: 'evidence',
      text: text(30),
      roleId: null,
    });

    const voter = student(31).session;
    // Five taps in flight at once: the vote document's id is what decides.
    await Promise.allSettled(Array.from({ length: 5 }, () => toggleUpvote(voter, asked.id)));

    const [stored] = await listSessionQuestions(SESSION_ID);
    expect(stored?.upvotes).toBeGreaterThanOrEqual(0);
    expect(stored?.upvotes).toBeLessThanOrEqual(1);
    expect((await votesOf(voter.uid, SESSION_ID)).length).toBeLessThanOrEqual(1);
  });

  it('takes the vote back on a second, settled tap', async () => {
    await seedSession();
    const author = student(32);
    const asked = await askQuestion(author.session, SESSION_ID, author.profile, {
      category: 'evidence',
      text: text(32),
      roleId: null,
    });
    const voter = student(33).session;

    await toggleUpvote(voter, asked.id);
    expect((await listSessionQuestions(SESSION_ID))[0]?.upvotes).toBe(1);

    await toggleUpvote(voter, asked.id);
    expect((await listSessionQuestions(SESSION_ID))[0]?.upvotes).toBe(0);
    expect(await votesOf(voter.uid, SESSION_ID)).toEqual([]);
  });

  it('refuses a student upvoting their own question', async () => {
    await seedSession();
    const author = student(34);
    const asked = await askQuestion(author.session, SESSION_ID, author.profile, {
      category: 'evidence',
      text: text(34),
      roleId: null,
    });

    await expect(toggleUpvote(author.session, asked.id)).rejects.toThrow(/cannotUpvoteOwnQuestion/);
  });
});

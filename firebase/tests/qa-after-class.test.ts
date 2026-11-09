import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Questions after the presentation, answered in the app, settled by the
 * lecturer - and the attendance score read from all of it - against the real
 * database.
 */

process.env.GOOGLE_CLOUD_PROJECT ??= 'demo-casestudyhub';
process.env.FIREBASE_STORAGE_BUCKET ??= 'demo-casestudyhub.appspot.com';

const {
  getDb,
  askQuestion,
  answerQuestion,
  reviewQuestion,
  getQuestion,
  questionId,
  toggleUpvote,
  classParticipation,
  saveQaSettings,
  qaPolicyOfClass,
} = await import('@casestudyhub/core');
const { COLLECTIONS, DEFAULT_PRESENTATION_POLICY } = await import('@casestudyhub/shared');

const CLASS_ID = 'QA-A01';
const S1 = 'QA-PS1';
const S2 = 'QA-PS2';
const G1 = 'QA-G1';
const G2 = 'QA-G2';
const DAY = 24 * 3600_000;

const lecturer = { uid: 'qa_lecturer', email: 'gv@x.edu.vn', role: 'lecturer' as const };
const presenter = { uid: 'qa_presenter', email: 'p@x.edu.vn', role: 'student' as const };
const audience = { uid: 'qa_audience', email: 'a@x.edu.vn', role: 'student' as const };
const quiet = { uid: 'qa_quiet', email: 'q@x.edu.vn', role: 'student' as const };

const profile = (uid: string) => ({ fullName: `Name ${uid}`, studentId: uid.toUpperCase() });
const ask = (uid: { uid: string; email: string; role: 'student' }, sessionId: string) =>
  askQuestion(uid, sessionId, profile(uid.uid), {
    category: 'evidence',
    text: 'Which figure in the case supports the margin claim?',
    roleId: null,
  });

async function seedClass(extra: Record<string, unknown> = {}) {
  const policy = DEFAULT_PRESENTATION_POLICY;
  await getDb()
    .collection(COLLECTIONS.classes)
    .doc(CLASS_ID)
    .set({
      id: CLASS_ID,
      classCode: 'QA01',
      className: 'Hoi dap',
      courseId: 'QA-C1',
      semesterId: 'QA-S1',
      lecturerIds: [lecturer.uid],
      language: 'vi',
      presentationPolicyId: policy.id,
      presentationPolicyVersion: policy.version,
      joinMode: 'code',
      status: 'active',
      ...extra,
    });
}

async function seedSession(id: string, groupId: string, extra: Record<string, unknown> = {}) {
  await getDb()
    .collection(COLLECTIONS.presentationSessions)
    .doc(id)
    .set({
      id,
      classId: CLASS_ID,
      assignmentId: `${id}-A`,
      groupId,
      caseStudyId: 'QA-CS1',
      status: 'live',
      currentRoleId: null,
      runningSinceMs: null,
      accumulatedMs: 0,
      roleMs: {},
      questionsOpen: true,
      peerReviewOpen: true,
      startedAt: new Date(Date.now() - 2 * DAY).toISOString(),
      ...extra,
    });
}

async function seedStudent(uid: string, groupId: string) {
  const db = getDb();
  await db
    .collection(COLLECTIONS.classEnrollments)
    .doc(`${CLASS_ID}__${uid}`)
    .set({
      id: `${CLASS_ID}__${uid}`,
      classId: CLASS_ID,
      studentUid: uid,
      studentId: uid.toUpperCase(),
      fullName: `Name ${uid}`,
      email: `${uid}@x.edu.vn`,
      status: 'active',
      joinedVia: 'class_code',
    });
  await db
    .collection(COLLECTIONS.groupMembers)
    .doc(`${CLASS_ID}__${uid}`)
    .set({
      id: `${CLASS_ID}__${uid}`,
      classId: CLASS_ID,
      groupId,
      studentUid: uid,
      studentId: uid.toUpperCase(),
      fullName: `Name ${uid}`,
      roleIds: [],
      isLeader: false,
    });
}

async function seedReview(sessionId: string, reviewerUid: string, groupId: string) {
  await getDb()
    .collection(COLLECTIONS.peerReviews)
    .doc(`${sessionId}__${reviewerUid}`)
    .set({
      id: `${sessionId}__${reviewerUid}`,
      sessionId,
      classId: CLASS_ID,
      groupId,
      reviewerUid,
      reviewerName: reviewerUid,
      reviewerStudentId: reviewerUid.toUpperCase(),
      reviewerGroupId: null,
      scores: {},
      total: 10,
    });
}

async function endSession(id: string, endedAgoMs: number) {
  await getDb()
    .collection(COLLECTIONS.presentationSessions)
    .doc(id)
    .update({
      status: 'completed',
      questionsOpen: false,
      endedAt: new Date(Date.now() - endedAgoMs).toISOString(),
    });
}

async function wipe() {
  const db = getDb();
  const jobs = [
    db.collection(COLLECTIONS.presentationSessions).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.questions).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.questionVotes).where('sessionId', 'in', [S1, S2]).get(),
    db.collection(COLLECTIONS.questionResponses).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.groupMembers).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.classEnrollments).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.peerReviews).where('classId', '==', CLASS_ID).get(),
    db.collection(COLLECTIONS.notifications).where('recipientUid', '==', audience.uid).get(),
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
  await seedClass();
  await seedStudent(presenter.uid, G1);
  await seedStudent(audience.uid, G2);
  await seedStudent(quiet.uid, G2);
  await seedSession(S1, G1);
});

afterAll(wipe);

describe('asking after the presentation', () => {
  it('closes with the session when the class keeps the old rule', async () => {
    await endSession(S1, 1000);
    await expect(ask(audience, S1)).rejects.toThrow(/questionsClosed/);
  });

  it('stays open for the days the lecturer allowed', async () => {
    await saveQaSettings(lecturer, CLASS_ID, { afterClassQa: { askDays: 2, answerDays: 0 } });
    await endSession(S1, DAY);
    await expect(ask(audience, S1)).resolves.toBeTruthy();
  });

  it('closes once those days have passed', async () => {
    await saveQaSettings(lecturer, CLASS_ID, { afterClassQa: { askDays: 2, answerDays: 0 } });
    await endSession(S1, 3 * DAY);
    await expect(ask(audience, S1)).rejects.toThrow(/questionsClosed/);
  });

  it('reads back the settings it saved, and defaults a class that never set them', async () => {
    expect((await qaPolicyOfClass(CLASS_ID)).afterClassQa).toEqual({ askDays: 0, answerDays: 0 });
    await saveQaSettings(lecturer, CLASS_ID, {
      attendancePolicy: { questionWeight: 1, reviewWeight: 0, featuredBonus: 0 },
    });
    expect((await qaPolicyOfClass(CLASS_ID)).attendancePolicy.questionWeight).toBe(1);
  });
});

describe('answering in the app, and the lecturer settling', () => {
  const id = () => questionId(S1, audience.uid);

  it('records where the group answered', async () => {
    await ask(audience, S1);
    await answerQuestion(
      presenter,
      'Presenter',
      id(),
      'Slide 9 shows the margin at 4 percent.',
      'app',
    );
    const stored = await getQuestion(id());
    expect(stored?.answerChannel).toBe('app');
    expect(stored?.status).toBe('answered');
  });

  it('settles the group’s answer as the group’s, and tells the asker', async () => {
    await ask(audience, S1);
    await answerQuestion(
      presenter,
      'Presenter',
      id(),
      'Slide 9 shows the margin at 4 percent.',
      'app',
    );

    const settled = await reviewQuestion(lecturer, 'Lecturer', {
      questionId: id(),
      finalAnswer: 'Slide 9 shows the margin at 4 percent.',
    });
    expect(settled.finalSource).toBe('group');
    // The group's own words are kept where they were.
    expect(settled.answerText).toBe('Slide 9 shows the margin at 4 percent.');

    const told = await getDb()
      .collection(COLLECTIONS.notifications)
      .where('recipientUid', '==', audience.uid)
      .get();
    expect(told.docs.some((doc) => doc.get('kind') === 'question.answered')).toBe(true);
  });

  it('knows a settled answer taken from the model, and one the lecturer wrote', async () => {
    await ask(audience, S1);
    await getDb()
      .collection(COLLECTIONS.questions)
      .doc(id())
      .update({
        aiSuggestion: {
          text: 'The case gives a 4 percent margin in 2025.',
          groundedInCase: true,
          provider: 'anthropic',
          model: 'claude-opus-5-5',
          createdAt: new Date().toISOString(),
        },
      });

    const fromModel = await reviewQuestion(lecturer, 'Lecturer', {
      questionId: id(),
      finalAnswer: 'The case gives a 4 percent margin in 2025.',
    });
    expect(fromModel.finalSource).toBe('ai');

    const own = await reviewQuestion(lecturer, 'Lecturer', {
      questionId: id(),
      finalAnswer: 'A 4 percent margin, down from 6 percent the year before.',
    });
    expect(own.finalSource).toBe('lecturer');
  });

  it('takes a settled answer back, and its mark with it', async () => {
    await ask(audience, S1);
    await reviewQuestion(lecturer, 'Lecturer', {
      questionId: id(),
      finalAnswer: 'A settled answer long enough to keep.',
      featuredAnswer: true,
    });
    const back = await reviewQuestion(lecturer, 'Lecturer', {
      questionId: id(),
      finalAnswer: null,
    });
    expect(back.finalAnswer).toBeUndefined();
    expect(back.featuredAnswer).toBe(false);
  });

  it('will not mark an answer that does not exist', async () => {
    await ask(audience, S1);
    await expect(
      reviewQuestion(lecturer, 'Lecturer', { questionId: id(), featuredAnswer: true }),
    ).rejects.toThrow(/nothingToFeature/);
  });

  it('drops a suggestion when the student rewrites the question, and keeps the star', async () => {
    await ask(audience, S1);
    await getDb()
      .collection(COLLECTIONS.questions)
      .doc(id())
      .update({
        aiSuggestion: {
          text: 'Old suggestion.',
          groundedInCase: true,
          provider: 'gemini',
          model: 'g',
          createdAt: new Date().toISOString(),
        },
        featuredQuestion: true,
      });

    await ask(audience, S1);
    const stored = await getQuestion(id());
    expect(stored?.aiSuggestion).toBeUndefined();
    expect(stored?.featuredQuestion).toBe(true);
  });

  it('will not let a settled question be rewritten under its answer', async () => {
    await ask(audience, S1);
    await reviewQuestion(lecturer, 'Lecturer', {
      questionId: id(),
      finalAnswer: 'A settled answer long enough to keep.',
    });
    await expect(ask(audience, S1)).rejects.toThrow(/questionAlreadyAnswered/);
  });
});

describe('participation and attendance', () => {
  it('reads who asked and who scored, leaving out each student’s own presentation', async () => {
    await seedSession(S2, G2);
    // S1 is G1 presenting: the audience asks and scores, the quiet one does neither.
    await ask(audience, S1);
    await seedReview(S1, audience.uid, G1);
    // S2 is G2 presenting: the presenter asks; the two of G2 are presenting.
    await ask(presenter, S2);
    await toggleUpvote(presenter, questionId(S1, audience.uid));
    await reviewQuestion(lecturer, 'Lecturer', {
      questionId: questionId(S1, audience.uid),
      featuredQuestion: true,
    });

    const data = await classParticipation(CLASS_ID);
    expect(data.sessions.map((session) => session.id).sort()).toEqual([S1, S2].sort());

    const row = (uid: string) => data.rows.find((entry) => entry.studentUid === uid);
    expect(row(audience.uid)).toMatchObject({
      eligibleSessions: 1,
      sessionsAsked: 1,
      sessionsReviewed: 1,
      questions: 1,
      featuredQuestions: 1,
      upvotesReceived: 1,
      // Both actions in the one presentation, plus the bonus, capped at ten.
      attendance: 10,
    });
    expect(row(presenter.uid)).toMatchObject({
      eligibleSessions: 1,
      sessionsAsked: 1,
      sessionsReviewed: 0,
      upvotesGiven: 1,
      attendance: 5,
    });
    expect(row(quiet.uid)).toMatchObject({ eligibleSessions: 1, attendance: 0 });
  });

  it('leaves a presentation that has not started out of everything', async () => {
    await seedSession(S2, G2, { status: 'scheduled', startedAt: undefined });
    const data = await classParticipation(CLASS_ID);
    expect(data.sessions.map((session) => session.id)).toEqual([S1]);
  });

  it('counts the group’s answers by where they were given', async () => {
    await ask(audience, S1);
    await ask(quiet, S1);
    await answerQuestion(
      presenter,
      'P',
      questionId(S1, audience.uid),
      'An answer in the room.',
      'class',
    );
    await answerQuestion(
      presenter,
      'P',
      questionId(S1, quiet.uid),
      'An answer written later.',
      'app',
    );

    const data = await classParticipation(CLASS_ID);
    expect(data.rows.find((row) => row.studentUid === presenter.uid)).toMatchObject({
      answersInClass: 1,
      answersInApp: 1,
    });
  });
});

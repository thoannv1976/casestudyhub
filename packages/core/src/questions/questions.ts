import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  MAX_SELECTED_QUESTIONS,
  afterClassQaSchema,
  anonymiseForReuse,
  askerTally,
  attendancePolicySchema,
  classQuestionSchema,
  questionWindowOpen,
  type AfterClassQa,
  type AnswerChannel,
  type AskQuestionRequest,
  type AskerTally,
  type AttendancePolicy,
  type ClassQuestion,
  type ReviewQuestionRequest,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { notify } from '../notifications/notifications';
import { AppError } from '../errors';
import { getSession } from '../sessions/sessions';
import { listRoster } from '../academic/enrollment';
import { findMembership, listMembers } from '../groups/groups';
import type { SessionUser } from '../auth/types';

/**
 * The question bank (SRS Module 10.3).
 *
 * One question per student per presentation, editable while the window is
 * open. The document id carries that rule - `sessionId__uid` cannot exist
 * twice - so a student who presses send twice ends up with one question, and
 * editing is simply writing the same document again.
 */

export function questionId(sessionId: string, uid: string): string {
  return `${sessionId}__${uid}`;
}

function parse(data: FirebaseFirestore.DocumentData): ClassQuestion | null {
  const parsed = classQuestionSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** A class's after-class Q&A and attendance settings, defaulted when never set. */
export async function qaPolicyOfClass(classId: string): Promise<{
  afterClassQa: AfterClassQa;
  attendancePolicy: AttendancePolicy;
  /** In-class Q&A held in another app (ClassInteract), when the lecturer set one. */
  liveQaUrl: string | null;
}> {
  const snapshot = await getDb().collection(COLLECTIONS.classes).doc(classId).get();
  const afterClassQa = afterClassQaSchema.safeParse(snapshot.get('afterClassQa') ?? {});
  const attendancePolicy = attendancePolicySchema.safeParse(snapshot.get('attendancePolicy') ?? {});
  return {
    afterClassQa: afterClassQa.success ? afterClassQa.data : afterClassQaSchema.parse({}),
    attendancePolicy: attendancePolicy.success
      ? attendancePolicy.data
      : attendancePolicySchema.parse({}),
    liveQaUrl: typeof snapshot.get('liveQaUrl') === 'string' ? snapshot.get('liveQaUrl') : null,
  };
}

export interface AskerProfile {
  fullName: string;
  studentId: string;
}

export async function askQuestion(
  student: SessionUser,
  sessionId: string,
  profile: AskerProfile,
  input: Required<Pick<AskQuestionRequest, 'category' | 'text'>> &
    Pick<AskQuestionRequest, 'roleId' | 'anonymousToClass'>,
): Promise<ClassQuestion> {
  const session = await getSession(sessionId);
  if (!session) throw new AppError('NOT_FOUND', 'errors.sessionNotFound');
  // Open in the room, or - where the class allows it - for some days after,
  // for a student who watched the presentation and thought of it later.
  const { afterClassQa } = await qaPolicyOfClass(session.classId);
  if (!questionWindowOpen(session, afterClassQa, Date.now())) {
    throw new AppError('POLICY_VIOLATION', 'errors.questionsClosed');
  }

  // The presenting group answers questions; it does not ask itself any.
  const membership = await findMembership(session.classId, student.uid);
  if (membership?.groupId === session.groupId) {
    throw new AppError('POLICY_VIOLATION', 'errors.cannotQuestionOwnGroup');
  }

  const db = getDb();
  const ref = db.collection(COLLECTIONS.questions).doc(questionId(sessionId, student.uid));
  const existing = await ref.get();

  // Once a group has chosen a question to answer aloud, changing its text
  // underneath them would be unfair to the group.
  if (existing.exists && existing.get('status') !== 'submitted') {
    throw new AppError('CONFLICT', 'errors.questionAlreadySelected');
  }
  // Nor once it has an answer the lecturer settled: that answer is to this text.
  if (existing.exists && existing.get('finalAnswer')) {
    throw new AppError('CONFLICT', 'errors.questionAlreadyAnswered');
  }

  const record = {
    id: ref.id,
    kind: session.kind,
    // Only a case study has a bank for later cohorts to inherit; a project's
    // questions belong to that group's presentation and nowhere else.
    ...(session.caseStudyId ? { caseStudyId: session.caseStudyId } : {}),
    sessionId,
    classId: session.classId,
    groupId: session.groupId,
    askedByUid: student.uid,
    askedByName: profile.fullName,
    askedByStudentId: profile.studentId,
    anonymousToClass: input.anonymousToClass !== false,
    roleId: input.roleId ?? null,
    category: input.category,
    text: input.text,
    upvotes: existing.exists ? ((existing.get('upvotes') as number | undefined) ?? 0) : 0,
    status: 'submitted' as const,
    answeredByAi: false,
    // A mark the lecturer gave survives the student fixing a typo.
    featuredQuestion: existing.exists ? existing.get('featuredQuestion') === true : false,
    featuredAnswer: false,
  };

  await ref.set(
    {
      ...record,
      updatedAt: FieldValue.serverTimestamp(),
      // A suggestion written for the old wording is a suggestion for a
      // question nobody is asking any more.
      ...(existing.exists ? { aiSuggestion: FieldValue.delete() } : {}),
      ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  );

  return record;
}

export async function listSessionQuestions(sessionId: string): Promise<ClassQuestion[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.questions)
    .where('sessionId', '==', sessionId)
    .get();

  return snapshot.docs
    .map((doc) => parse(doc.data()))
    .filter((question): question is ClassQuestion => question !== null)
    .sort((a, b) => b.upvotes - a.upvotes || a.id.localeCompare(b.id));
}

/**
 * Every question ever asked about a case, across classes and years.
 *
 * `forOtherCohort` strips the askers' identities: this is the reading a later
 * class gets, where the questions are the material and the names are not.
 */
export async function listCaseQuestions(
  caseStudyId: string,
  options: { forOtherCohort?: boolean } = {},
): Promise<ClassQuestion[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.questions)
    .where('caseStudyId', '==', caseStudyId)
    .get();

  const questions = snapshot.docs
    .map((doc) => parse(doc.data()))
    .filter((question): question is ClassQuestion => question !== null);

  return (options.forOtherCohort ? questions.map(anonymiseForReuse) : questions).sort(
    (a, b) => b.upvotes - a.upvotes,
  );
}

/**
 * One vote per person per question, enforced by the vote document's id rather
 * than by reading the count first.
 */
export async function toggleUpvote(voter: SessionUser, questionIdValue: string): Promise<number> {
  const db = getDb();
  const questionRef = db.collection(COLLECTIONS.questions).doc(questionIdValue);
  const voteRef = db.collection(COLLECTIONS.questionVotes).doc(`${questionIdValue}__${voter.uid}`);

  return db.runTransaction(async (tx) => {
    const [question, vote] = await Promise.all([tx.get(questionRef), tx.get(voteRef)]);
    if (!question.exists) throw new AppError('NOT_FOUND', 'errors.questionNotFound');

    const current = (question.get('upvotes') as number | undefined) ?? 0;

    if (vote.exists) {
      tx.delete(voteRef);
      tx.update(questionRef, { upvotes: FieldValue.increment(-1) });
      return Math.max(0, current - 1);
    }

    if (question.get('askedByUid') === voter.uid) {
      throw new AppError('POLICY_VIOLATION', 'errors.cannotUpvoteOwnQuestion');
    }

    tx.create(voteRef, {
      questionId: questionIdValue,
      // The session is stored, not derived from the id, so a viewer's votes
      // can be fetched with one bounded query instead of reading every vote
      // they have ever cast.
      sessionId: question.get('sessionId') as string,
      voterUid: voter.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(questionRef, { upvotes: FieldValue.increment(1) });
    return current + 1;
  });
}

/**
 * Which questions this viewer has upvoted in this session.
 *
 * Filtered by session in the query, not afterwards in JavaScript. The wall
 * calls this every ten seconds for every student in the room, and a student
 * accumulates votes all term: reading them all and discarding most was a scan
 * that grew for the rest of the semester.
 */
export async function votesOf(voterUid: string, sessionId: string): Promise<string[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.questionVotes)
    .where('sessionId', '==', sessionId)
    .where('voterUid', '==', voterUid)
    .get();

  return snapshot.docs.map((doc) => doc.get('questionId') as string);
}

/**
 * The presenting group picks the two or three questions it will answer aloud.
 * The cap comes from the class format, not from the interface: a group with
 * ten minutes of Q&A cannot answer twenty.
 */
export async function selectQuestion(
  actor: SessionUser,
  questionIdValue: string,
  selected: boolean,
): Promise<void> {
  const db = getDb();
  const ref = db.collection(COLLECTIONS.questions).doc(questionIdValue);

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new AppError('NOT_FOUND', 'errors.questionNotFound');
    if (snapshot.get('status') === 'answered') {
      throw new AppError('CONFLICT', 'errors.questionAlreadyAnswered');
    }

    if (selected) {
      const already = await tx.get(
        db
          .collection(COLLECTIONS.questions)
          .where('sessionId', '==', snapshot.get('sessionId'))
          .where('status', '==', 'selected'),
      );
      if (already.size >= MAX_SELECTED_QUESTIONS) {
        throw new AppError('POLICY_VIOLATION', 'errors.tooManySelected', {
          details: { max: MAX_SELECTED_QUESTIONS },
        });
      }
    }

    tx.update(ref, {
      status: selected ? 'selected' : 'submitted',
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  if (selected) {
    // Out of fifty or more questions the group answers two or three. Being one
    // of them is worth knowing, and the asker is rarely watching the wall at
    // that moment.
    const chosen = await ref.get();
    await notify({
      recipientUids: [chosen.get('askedByUid') as string],
      kind: 'question.selected',
      params: {},
      href: `/sessions/${chosen.get('sessionId') as string}`,
    });
  }

  await writeAuditLog({
    action: 'question.selected',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.questions}/${questionIdValue}`,
    after: { selected },
  });
}

/**
 * Records an answer from the presenting group, and who gave it: aloud in the
 * room, or written in the app once the session has ended.
 */
export async function answerQuestion(
  responder: SessionUser,
  responderName: string,
  questionIdValue: string,
  answerText: string,
  channel: AnswerChannel = 'class',
): Promise<void> {
  const db = getDb();
  const ref = db.collection(COLLECTIONS.questions).doc(questionIdValue);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new AppError('NOT_FOUND', 'errors.questionNotFound');

  await ref.update({
    answerText,
    answeredByUid: responder.uid,
    answeredByName: responderName,
    answeredAt: new Date().toISOString(),
    answeredByAi: false,
    answerChannel: channel,
    status: 'answered',
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Who answered which question is evidence for the individual mark, and for
  // the checklist that every member answered something.
  await db.collection(COLLECTIONS.questionResponses).add({
    questionId: questionIdValue,
    sessionId: snapshot.get('sessionId'),
    classId: snapshot.get('classId'),
    groupId: snapshot.get('groupId'),
    responderUid: responder.uid,
    responderName,
    roleId: snapshot.get('roleId') ?? null,
    channel,
    createdAt: FieldValue.serverTimestamp(),
  });
}

/** Every question asked in one class, across all its presentations. */
export async function listClassQuestions(classId: string): Promise<ClassQuestion[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.questions)
    .where('classId', '==', classId)
    .get();

  return snapshot.docs
    .map((doc) => parse(doc.data()))
    .filter((question): question is ClassQuestion => question !== null)
    .sort((a, b) => b.upvotes - a.upvotes || a.id.localeCompare(b.id));
}

export async function getQuestion(questionIdValue: string): Promise<ClassQuestion | null> {
  const snapshot = await getDb().collection(COLLECTIONS.questions).doc(questionIdValue).get();
  return snapshot.exists ? parse(snapshot.data() as FirebaseFirestore.DocumentData) : null;
}

/**
 * The lecturer settles an answer, or marks a question or an answer as worth
 * reading again.
 *
 * Settling is choosing what the class and every later cohort will read: the
 * group's answer as it stands, the model's suggestion, or the lecturer's own
 * wording. Which of those it was is recorded, so a reader can tell. Nothing a
 * student wrote is overwritten: the group's own answer stays where it was.
 */
export async function reviewQuestion(
  actor: SessionUser,
  actorName: string,
  input: ReviewQuestionRequest,
): Promise<ClassQuestion> {
  const db = getDb();
  const ref = db.collection(COLLECTIONS.questions).doc(input.questionId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new AppError('NOT_FOUND', 'errors.questionNotFound');
  const question = parse(snapshot.data() as FirebaseFirestore.DocumentData);
  if (!question) throw new AppError('INTERNAL', 'errors.unexpected');

  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  const after: Record<string, unknown> = {};

  if (input.finalAnswer === null) {
    patch.finalAnswer = FieldValue.delete();
    patch.finalSource = FieldValue.delete();
    patch.finalizedByUid = FieldValue.delete();
    patch.finalizedByName = FieldValue.delete();
    patch.finalizedAt = FieldValue.delete();
    // An answer that is no longer settled cannot be the good one.
    patch.featuredAnswer = false;
    after.finalAnswer = null;
  } else if (typeof input.finalAnswer === 'string') {
    const text = input.finalAnswer.trim();
    const source =
      question.answerText && !question.answeredByAi && text === question.answerText.trim()
        ? 'group'
        : question.aiSuggestion && text === question.aiSuggestion.text.trim()
          ? 'ai'
          : 'lecturer';
    patch.finalAnswer = text;
    patch.finalSource = source;
    patch.finalizedByUid = actor.uid;
    patch.finalizedByName = actorName;
    patch.finalizedAt = new Date().toISOString();
    after.finalSource = source;
  }

  if (typeof input.featuredQuestion === 'boolean') {
    patch.featuredQuestion = input.featuredQuestion;
    after.featuredQuestion = input.featuredQuestion;
  }
  if (typeof input.featuredAnswer === 'boolean') {
    const hasAnswer =
      input.finalAnswer === null
        ? false
        : Boolean(input.finalAnswer || question.finalAnswer || question.answerText);
    if (input.featuredAnswer && !hasAnswer) {
      throw new AppError('POLICY_VIOLATION', 'errors.nothingToFeature');
    }
    patch.featuredAnswer = input.featuredAnswer;
    after.featuredAnswer = input.featuredAnswer;
  }

  await ref.update(patch);

  await writeAuditLog({
    action: 'question.reviewed',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.questions}/${input.questionId}`,
    classId: question.classId,
    after,
  });

  // The asker hears when their question has an answer they can rely on.
  if (typeof input.finalAnswer === 'string' && !question.finalAnswer) {
    await notify({
      recipientUids: [question.askedByUid],
      kind: 'question.answered',
      params: {},
      href: `/sessions/${question.sessionId}`,
    }).catch(() => undefined);
  }

  return (await getQuestion(input.questionId)) as ClassQuestion;
}

export interface QaCompletion {
  classQuestions: number;
  answered: number;
  membersAnswered: string[];
  membersWithoutAnswer: string[];
  everyMemberAnswered: boolean;
  enoughClassQuestions: boolean;
}

/**
 * The Q&A checklist of the Presentation Guide: at least two questions from the
 * class, and every member of the group has answered at least one.
 */
export function qaCompletion(
  questions: readonly ClassQuestion[],
  groupMemberUids: readonly string[],
  responderUids: readonly string[],
  minClassQuestions: number,
): QaCompletion {
  const answered = questions.filter((question) => question.status === 'answered').length;
  const membersAnswered = groupMemberUids.filter((uid) => responderUids.includes(uid));
  const membersWithoutAnswer = groupMemberUids.filter((uid) => !responderUids.includes(uid));

  return {
    classQuestions: questions.length,
    answered,
    membersAnswered,
    membersWithoutAnswer,
    everyMemberAnswered: membersWithoutAnswer.length === 0 && groupMemberUids.length > 0,
    enoughClassQuestions: questions.length >= minClassQuestions,
  };
}

/**
 * Who in the class has asked their question for one presentation, and who has
 * not (SRS Module 10.3).
 *
 * The names of the ones who have not are the point. A count tells a lecturer
 * that four people are missing; the names let them say four names out loud
 * while the room is still in front of them.
 *
 * The presenting group is left out: they answer questions, they do not ask
 * them, and counting them as silent would make the tally something the lecturer
 * reads out wrongly.
 */
export interface AskerRow {
  studentUid: string;
  studentId: string;
  fullName: string;
  asked: boolean;
}

export interface SessionAskers extends AskerTally {
  rows: AskerRow[];
}

export async function sessionAskers(sessionId: string): Promise<SessionAskers> {
  const session = await getSession(sessionId);
  if (!session) throw new AppError('NOT_FOUND', 'errors.sessionNotFound');

  const [roster, members, questions] = await Promise.all([
    listRoster(session.classId),
    listMembers(session.classId),
    listSessionQuestions(sessionId),
  ]);

  const active = roster.filter((row) => row.status === 'active' && row.studentUid);
  const tally = askerTally({
    classUids: active.map((row) => row.studentUid as string),
    presenterUids: members
      .filter((member) => member.groupId === session.groupId)
      .map((member) => member.studentUid),
    askerUids: questions.map((question) => question.askedByUid),
  });

  const asked = new Set(tally.askedUids);
  const expected = new Set([...tally.askedUids, ...tally.missingUids]);

  return {
    ...tally,
    rows: active
      .filter((row) => expected.has(row.studentUid as string))
      .map((row) => ({
        studentUid: row.studentUid as string,
        studentId: row.studentId,
        fullName: row.fullName,
        asked: asked.has(row.studentUid as string),
      })),
  };
}

export async function listResponders(sessionId: string): Promise<string[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.questionResponses)
    .where('sessionId', '==', sessionId)
    .get();
  return [...new Set(snapshot.docs.map((doc) => doc.get('responderUid') as string))];
}

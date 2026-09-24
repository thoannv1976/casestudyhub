import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  MAX_SELECTED_QUESTIONS,
  anonymiseForReuse,
  classQuestionSchema,
  type AskQuestionRequest,
  type ClassQuestion,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { notify } from '../notifications/notifications';
import { AppError } from '../errors';
import { getSession } from '../sessions/sessions';
import { findMembership } from '../groups/groups';
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
  if (!session.questionsOpen) throw new AppError('POLICY_VIOLATION', 'errors.questionsClosed');

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

  const record = {
    id: ref.id,
    caseStudyId: session.caseStudyId,
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
  };

  await ref.set(
    {
      ...record,
      updatedAt: FieldValue.serverTimestamp(),
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

/** Records the answer given in the room, and who gave it. */
export async function answerQuestion(
  responder: SessionUser,
  responderName: string,
  questionIdValue: string,
  answerText: string,
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
    createdAt: FieldValue.serverTimestamp(),
  });
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

export async function listResponders(sessionId: string): Promise<string[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.questionResponses)
    .where('sessionId', '==', sessionId)
    .get();
  return [...new Set(snapshot.docs.map((doc) => doc.get('responderUid') as string))];
}

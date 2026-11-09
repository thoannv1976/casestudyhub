import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  attendanceScore,
  type AfterClassQa,
  type AttendancePolicy,
  type AttendanceSession,
  type PresentationSession,
  type QaSettingsRequest,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { AppError } from '../errors';
import { listRoster } from '../academic/enrollment';
import { listGroups, listMembers } from '../groups/groups';
import { listSessions } from '../sessions/sessions';
import { listClassQuestions, qaPolicyOfClass } from '../questions/questions';
import type { SessionUser } from '../auth/types';

/**
 * Who took part, presentation by presentation (mức độ tham gia, chuyên cần).
 *
 * A presentation counts once it has started. A student is expected at every
 * presentation but their own group's: there they answer, they do not ask or
 * score. Being there is read from what they did - asked a question, scored
 * the group - because that is the only attendance the platform can see.
 */

export interface ParticipationSession {
  id: string;
  groupId: string;
  groupName: string;
  caseStudyId?: string;
  status: PresentationSession['status'];
  startedAt?: string;
}

export interface ParticipationRow {
  studentUid: string;
  studentId: string;
  fullName: string;
  groupName: string | null;
  /** Presentations the student was in the audience of. */
  eligibleSessions: number;
  sessionsAsked: number;
  sessionsReviewed: number;
  questions: number;
  featuredQuestions: number;
  upvotesReceived: number;
  upvotesGiven: number;
  answersInClass: number;
  answersInApp: number;
  featuredAnswers: number;
  /** Out of ten; null before any presentation the student could attend. */
  attendance: number | null;
  /** Per presentation, in the order of `sessions`. */
  perSession: AttendanceSession[];
}

export interface ClassParticipation {
  sessions: ParticipationSession[];
  rows: ParticipationRow[];
  policy: AttendancePolicy;
  afterClassQa: AfterClassQa;
}

/** Firestore takes at most thirty values in one `in` filter. */
function chunks<T>(values: readonly T[], size = 30): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    out.push(values.slice(start, start + size));
  }
  return out;
}

export async function classParticipation(classId: string): Promise<ClassParticipation> {
  const db = getDb();
  const [roster, members, groups, allSessions, questions, reviews, policy] = await Promise.all([
    listRoster(classId),
    listMembers(classId),
    listGroups(classId),
    listSessions(classId),
    listClassQuestions(classId),
    db.collection(COLLECTIONS.peerReviews).where('classId', '==', classId).get(),
    qaPolicyOfClass(classId),
  ]);

  const started = allSessions
    .filter((session) => session.status !== 'scheduled')
    .sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));

  const votes = new Map<string, number>();
  for (const batch of chunks(started.map((session) => session.id))) {
    const snapshot = await db
      .collection(COLLECTIONS.questionVotes)
      .where('sessionId', 'in', batch)
      .get();
    for (const doc of snapshot.docs) {
      const voter = doc.get('voterUid') as string;
      votes.set(voter, (votes.get(voter) ?? 0) + 1);
    }
  }

  const groupName = new Map(groups.map((group) => [group.id, group.groupName]));
  const groupOf = new Map(members.map((member) => [member.studentUid, member.groupId]));

  const asked = new Set(
    questions.map((question) => `${question.sessionId}|${question.askedByUid}`),
  );
  const reviewed = new Set(
    reviews.docs.map(
      (doc) => `${doc.get('sessionId') as string}|${doc.get('reviewerUid') as string}`,
    ),
  );

  const rows: ParticipationRow[] = roster
    .filter((row) => row.status === 'active' && row.studentUid)
    .map((row) => {
      const uid = row.studentUid as string;
      const ownGroup = groupOf.get(uid) ?? null;

      const perSession = started.map((session) => ({
        eligible: session.groupId !== ownGroup,
        asked: asked.has(`${session.id}|${uid}`),
        reviewed: reviewed.has(`${session.id}|${uid}`),
      }));
      const mine = questions.filter((question) => question.askedByUid === uid);
      const answered = questions.filter(
        (question) => question.answeredByUid === uid && !question.answeredByAi,
      );
      const featuredQuestions = mine.filter((question) => question.featuredQuestion).length;

      return {
        studentUid: uid,
        studentId: row.studentId,
        fullName: row.fullName,
        groupName: ownGroup ? (groupName.get(ownGroup) ?? null) : null,
        eligibleSessions: perSession.filter((session) => session.eligible).length,
        sessionsAsked: perSession.filter((session) => session.eligible && session.asked).length,
        sessionsReviewed: perSession.filter((session) => session.eligible && session.reviewed)
          .length,
        questions: mine.length,
        featuredQuestions,
        upvotesReceived: mine.reduce((sum, question) => sum + question.upvotes, 0),
        upvotesGiven: votes.get(uid) ?? 0,
        answersInClass: answered.filter((question) => question.answerChannel !== 'app').length,
        answersInApp: answered.filter((question) => question.answerChannel === 'app').length,
        featuredAnswers: answered.filter((question) => question.featuredAnswer).length,
        attendance: attendanceScore(perSession, featuredQuestions, policy.attendancePolicy),
        perSession,
      };
    })
    .sort((a, b) => a.studentId.localeCompare(b.studentId));

  return {
    sessions: started.map((session) => ({
      id: session.id,
      groupId: session.groupId,
      groupName: groupName.get(session.groupId) ?? session.groupId,
      caseStudyId: session.caseStudyId,
      status: session.status,
      startedAt: session.startedAt,
    })),
    rows,
    policy: policy.attendancePolicy,
    afterClassQa: policy.afterClassQa,
  };
}

/** The lecturer changes how long Q&A stays open after class, or how attendance is scored. */
export async function saveQaSettings(
  actor: SessionUser,
  classId: string,
  input: QaSettingsRequest,
): Promise<void> {
  const ref = getDb().collection(COLLECTIONS.classes).doc(classId);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new AppError('NOT_FOUND', 'errors.classNotFound');

  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (input.afterClassQa) patch.afterClassQa = input.afterClassQa;
  if (input.attendancePolicy) patch.attendancePolicy = input.attendancePolicy;
  await ref.update(patch);

  await writeAuditLog({
    action: 'class.qa_settings_changed',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.classes}/${classId}`,
    classId,
    before: {
      afterClassQa: snapshot.get('afterClassQa') ?? null,
      attendancePolicy: snapshot.get('attendancePolicy') ?? null,
    },
    after: {
      ...(input.afterClassQa ? { afterClassQa: input.afterClassQa } : {}),
      ...(input.attendancePolicy ? { attendancePolicy: input.attendancePolicy } : {}),
    },
  });
}

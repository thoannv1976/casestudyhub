import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  presentationSessionSchema,
  type PresentationSession,
  type PresentationRoleId,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { getPolicy, policyOfAssignment } from '../policy/policy-store';
import { AppError } from '../errors';
import { getAssignment } from '../assignments/assignments';
import { projectTargetOf } from '../projects/projects';
import type { SessionUser } from '../auth/types';

/**
 * Presentation sessions (SRS Module 10).
 *
 * The clock is kept as a start timestamp plus accumulated milliseconds, and
 * the elapsed time is computed when someone reads it. Writing a ticking number
 * would cost a write every second for every class in progress, and would still
 * disagree between devices.
 */

function parse(data: FirebaseFirestore.DocumentData): PresentationSession | null {
  const parsed = presentationSessionSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function getSession(sessionId: string): Promise<PresentationSession | null> {
  const snapshot = await getDb().collection(COLLECTIONS.presentationSessions).doc(sessionId).get();
  return snapshot.exists ? parse(snapshot.data() as FirebaseFirestore.DocumentData) : null;
}

export async function listSessions(classId: string): Promise<PresentationSession[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.presentationSessions)
    .where('classId', '==', classId)
    .get();

  return snapshot.docs
    .map((doc) => parse(doc.data()))
    .filter((session): session is PresentationSession => session !== null);
}

export async function findSessionForAssignment(
  assignmentId: string,
): Promise<PresentationSession | null> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.presentationSessions)
    .where('assignmentId', '==', assignmentId)
    .limit(1)
    .get();

  const doc = snapshot.docs[0];
  return doc ? parse(doc.data()) : null;
}

/**
 * Opens the room for a group's presentation - of a case study, or of the class
 * group project. One session per piece of work: a second one would split the
 * questions and the peer scores of one presentation across two records.
 *
 * The room itself does not care which it is. The clock, the question wall, the
 * upvotes and the peer scores are the same machinery, which is why the project
 * gets them for the price of letting a session exist without a case.
 */
export async function startSession(
  actor: SessionUser,
  assignmentId: string,
): Promise<PresentationSession> {
  const project = await projectTargetOf(assignmentId);
  const assignment = project ? null : await getAssignment(assignmentId);
  if (!project && !assignment) throw new AppError('NOT_FOUND', 'errors.assignmentNotFound');

  const work = project
    ? { classId: project.classId, groupId: project.groupId, kind: 'group_project' as const }
    : {
        classId: assignment!.classId,
        groupId: assignment!.groupId,
        kind: 'case_study' as const,
        caseStudyId: assignment!.caseStudyId,
      };

  const existing = await findSessionForAssignment(assignmentId);
  if (existing) {
    if (existing.status === 'completed') {
      throw new AppError('CONFLICT', 'errors.sessionAlreadyCompleted');
    }
    return existing;
  }

  const db = getDb();
  const ref = db.collection(COLLECTIONS.presentationSessions).doc();
  const policy = project
    ? await getPolicy(project.policyId, project.policyVersion)
    : await policyOfAssignment(assignment!);
  const firstRole = policy.roles[0]?.id ?? 'R1';

  const session = {
    id: ref.id,
    classId: work.classId,
    assignmentId,
    groupId: work.groupId,
    kind: work.kind,
    ...('caseStudyId' in work && work.caseStudyId ? { caseStudyId: work.caseStudyId } : {}),
    status: 'live' as const,
    currentRoleId: firstRole,
    runningSinceMs: Timestamp.now().toMillis(),
    accumulatedMs: 0,
    roleMs: {},
    // The class starts asking as soon as the group starts speaking: the point
    // is to gather the whole room's questions, not only those thought of in
    // the last two minutes.
    questionsOpen: true,
    peerReviewOpen: false,
    startedAt: new Date().toISOString(),
  };

  await ref.set({ ...session, createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid });

  await writeAuditLog({
    action: 'session.started',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.presentationSessions}/${ref.id}`,
    classId: work.classId,
    after: { groupId: work.groupId, kind: work.kind },
  });

  return session;
}

/** Folds the running stretch into the totals, leaving the clock stopped. */
function settle(session: PresentationSession, nowMs: number) {
  if (session.runningSinceMs === null) {
    return { accumulatedMs: session.accumulatedMs, roleMs: { ...session.roleMs } };
  }

  const ran = Math.max(0, nowMs - session.runningSinceMs);
  const roleMs = { ...session.roleMs };
  if (session.currentRoleId) {
    roleMs[session.currentRoleId] = (roleMs[session.currentRoleId] ?? 0) + ran;
  }
  return { accumulatedMs: session.accumulatedMs + ran, roleMs };
}

async function requireSession(sessionId: string): Promise<PresentationSession> {
  const session = await getSession(sessionId);
  if (!session) throw new AppError('NOT_FOUND', 'errors.sessionNotFound');
  return session;
}

export async function pauseTimer(sessionId: string): Promise<void> {
  const session = await requireSession(sessionId);
  if (session.runningSinceMs === null) return;

  const settled = settle(session, Timestamp.now().toMillis());
  await getDb()
    .collection(COLLECTIONS.presentationSessions)
    .doc(sessionId)
    .update({
      ...settled,
      runningSinceMs: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
}

export async function resumeTimer(sessionId: string): Promise<void> {
  const session = await requireSession(sessionId);
  if (session.runningSinceMs !== null) return;

  await getDb().collection(COLLECTIONS.presentationSessions).doc(sessionId).update({
    runningSinceMs: Timestamp.now().toMillis(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Hands the floor to the next role. The time spoken so far is banked against
 * the role that just finished, so a member carrying two roles is measured on
 * each of them (SRS 10.2).
 */
export async function switchRole(sessionId: string, roleId: PresentationRoleId): Promise<void> {
  const session = await requireSession(sessionId);
  const now = Timestamp.now().toMillis();
  const settled = settle(session, now);

  await getDb()
    .collection(COLLECTIONS.presentationSessions)
    .doc(sessionId)
    .update({
      ...settled,
      currentRoleId: roleId,
      runningSinceMs: session.runningSinceMs === null ? null : now,
      updatedAt: FieldValue.serverTimestamp(),
    });
}

export async function setSessionStatus(
  actor: SessionUser,
  sessionId: string,
  status: PresentationSession['status'],
): Promise<void> {
  const session = await requireSession(sessionId);
  const now = Timestamp.now().toMillis();

  const patch: Record<string, unknown> = {
    status,
    updatedAt: FieldValue.serverTimestamp(),
  };

  // Moving past the presentation stops the clock; the totals stay readable.
  if (status !== 'live') {
    const settled = settle(session, now);
    patch.accumulatedMs = settled.accumulatedMs;
    patch.roleMs = settled.roleMs;
    patch.runningSinceMs = null;
  }
  if (status === 'completed') {
    patch.endedAt = new Date().toISOString();
    patch.questionsOpen = false;
    patch.peerReviewOpen = false;
  }

  await getDb().collection(COLLECTIONS.presentationSessions).doc(sessionId).update(patch);

  await writeAuditLog({
    action: 'session.status_changed',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.presentationSessions}/${sessionId}`,
    classId: session.classId,
    before: { status: session.status },
    after: { status },
  });
}

export async function setWindow(
  sessionId: string,
  window: 'questions' | 'peerReview',
  open: boolean,
): Promise<void> {
  await requireSession(sessionId);
  await getDb()
    .collection(COLLECTIONS.presentationSessions)
    .doc(sessionId)
    .update({
      [window === 'questions' ? 'questionsOpen' : 'peerReviewOpen']: open,
      updatedAt: FieldValue.serverTimestamp(),
    });
}

/**
 * Whether the class may open the presenting group's slides.
 *
 * Phase 1 keeps every submission private to its group. This opens one narrow
 * gap, and the narrowness is the point: the slide deck only, of the group
 * whose session has started, and only from the moment it starts. The analysis
 * report, the role allocation sheet and the AI disclosure stay closed.
 */
export const CLASS_VISIBLE_DELIVERABLE_ID = 'slides-pdf';

/** The one document the class may open, by what is being presented. */
export const CLASS_VISIBLE_DELIVERABLE_IDS: Record<string, string> = {
  case_study: CLASS_VISIBLE_DELIVERABLE_ID,
  group_project: 'project-pitch-deck',
};

export async function classMayViewSubmission(submission: {
  assignmentId: string;
  deliverableId: string;
}): Promise<{ allowed: boolean; classId?: string }> {
  const session = await findSessionForAssignment(submission.assignmentId);
  if (!session) return { allowed: false };
  // The deck of whatever is being presented - the slides of a case study, the
  // pitch deck of the project. One document, and only that one.
  if (submission.deliverableId !== CLASS_VISIBLE_DELIVERABLE_IDS[session.kind]) {
    return { allowed: false };
  }
  if (session.status === 'scheduled') return { allowed: false };

  return { allowed: true, classId: session.classId };
}

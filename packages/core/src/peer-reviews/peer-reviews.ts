import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  peerReviewSchema,
  validatePeerScores,
  type PeerReview,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { policyOfAssignmentId } from '../policy/policy-store';
import { AppError } from '../errors';
import { getSession } from '../sessions/sessions';
import { findMembership } from '../groups/groups';
import type { SessionUser } from '../auth/types';

/**
 * Peer assessment (SRS Module 11).
 *
 * One review per student per presentation, so the document id is
 * `sessionId__uid` for the same reason a question's is: a student who presses
 * submit twice has changed their mind, not voted twice.
 *
 * These scores are never added to a grade. The shared module says why; this
 * file is what keeps it true - nothing here writes to `grades`.
 */

export function peerReviewId(sessionId: string, uid: string): string {
  return `${sessionId}__${uid}`;
}

function parse(data: FirebaseFirestore.DocumentData): PeerReview | null {
  const parsed = peerReviewSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export interface ReviewerProfile {
  fullName: string;
  studentId: string;
}

export async function submitPeerReview(
  reviewer: SessionUser,
  sessionId: string,
  profile: ReviewerProfile,
  input: { scores: Record<string, number>; comment?: string },
): Promise<PeerReview> {
  const session = await getSession(sessionId);
  if (!session) throw new AppError('NOT_FOUND', 'errors.sessionNotFound');
  if (!session.peerReviewOpen) throw new AppError('POLICY_VIOLATION', 'errors.peerReviewClosed');

  // A group cannot score itself. That is the whole point of peer assessment.
  const membership = await findMembership(session.classId, reviewer.uid);
  if (membership?.groupId === session.groupId) {
    throw new AppError('POLICY_VIOLATION', 'errors.cannotReviewOwnGroup');
  }

  const rubric = (await policyOfAssignmentId(session.assignmentId)).rubric;
  const checked = validatePeerScores(input.scores, rubric);
  if (!checked.ok) {
    throw new AppError('VALIDATION_FAILED', checked.messageKey, {
      details: checked.criterionId ? { criterionId: checked.criterionId } : undefined,
    });
  }

  const review: PeerReview = {
    id: peerReviewId(sessionId, reviewer.uid),
    sessionId,
    classId: session.classId,
    caseStudyId: session.caseStudyId,
    groupId: session.groupId,
    reviewerUid: reviewer.uid,
    reviewerName: profile.fullName,
    reviewerStudentId: profile.studentId,
    reviewerGroupId: membership?.groupId ?? null,
    scores: input.scores,
    total: checked.total,
    ...(input.comment ? { comment: input.comment } : {}),
    rubricId: rubric.id,
    rubricVersion: rubric.version,
    submittedAt: new Date().toISOString(),
  };

  await getDb()
    .collection(COLLECTIONS.peerReviews)
    .doc(review.id)
    .set({ ...review, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  return review;
}

export async function listPeerReviews(sessionId: string): Promise<PeerReview[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.peerReviews)
    .where('sessionId', '==', sessionId)
    .get();

  return snapshot.docs
    .map((doc) => parse(doc.data()))
    .filter((review): review is PeerReview => review !== null)
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

export async function getOwnPeerReview(sessionId: string, uid: string): Promise<PeerReview | null> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.peerReviews)
    .doc(peerReviewId(sessionId, uid))
    .get();
  return snapshot.exists ? parse(snapshot.data() as FirebaseFirestore.DocumentData) : null;
}

/** Every peer score a group has collected across its presentations. */
export async function listPeerReviewsForGroup(groupId: string): Promise<PeerReview[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.peerReviews)
    .where('groupId', '==', groupId)
    .get();

  return snapshot.docs
    .map((doc) => parse(doc.data()))
    .filter((review): review is PeerReview => review !== null);
}

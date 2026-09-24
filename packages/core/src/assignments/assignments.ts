import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  DEFAULT_PRESENTATION_POLICY,
  assignmentSchema,
  isSubmissionLate,
  submissionDeadlineFor,
  type Assignment,
  type Deliverable,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { groupMemberUids, notify } from '../notifications/notifications';
import { AppError } from '../errors';
import type { SessionUser } from '../auth/types';

/**
 * Assignments and deadlines (SRS Module 08).
 *
 * An assignment freezes the versions it runs under - the case, the policy and
 * the rubric - so a later change to any of them cannot alter work already set.
 * The deadline is derived from the policy rather than typed in, which is what
 * keeps "24 hours before the session" true when a course changes that number.
 */

export interface CreateAssignmentInput {
  classId: string;
  groupId: string;
  caseStudyId: string;
  /** ISO timestamp of the presentation itself. */
  presentationDate: string;
}

export async function createAssignment(
  actor: SessionUser,
  input: CreateAssignmentInput,
): Promise<string> {
  const db = getDb();
  const policy = DEFAULT_PRESENTATION_POLICY;

  const presentationMs = Date.parse(input.presentationDate);
  if (Number.isNaN(presentationMs)) {
    throw new AppError('VALIDATION_FAILED', 'errors.dateInvalid');
  }
  // A session already in the past would open a submission window that closed
  // before it existed.
  if (presentationMs <= Date.now()) {
    throw new AppError('VALIDATION_FAILED', 'errors.presentationInPast');
  }

  const [caseSnapshot, groupSnapshot, clash] = await Promise.all([
    db.collection(COLLECTIONS.caseStudies).doc(input.caseStudyId).get(),
    db.collection(COLLECTIONS.groups).doc(input.groupId).get(),
    db
      .collection(COLLECTIONS.assignments)
      .where('groupId', '==', input.groupId)
      .where('caseStudyId', '==', input.caseStudyId)
      .limit(1)
      .get(),
  ]);

  if (!caseSnapshot.exists) throw new AppError('NOT_FOUND', 'errors.caseNotFound');
  if (!groupSnapshot.exists) throw new AppError('NOT_FOUND', 'errors.groupNotFound');
  if (groupSnapshot.get('classId') !== input.classId) {
    throw new AppError('FORBIDDEN', 'errors.forbidden');
  }
  if (!clash.empty) throw new AppError('CONFLICT', 'errors.assignmentExists');
  if (caseSnapshot.get('status') !== 'published') {
    throw new AppError('POLICY_VIOLATION', 'errors.caseNotPublished');
  }

  const deadlineMs = submissionDeadlineFor(presentationMs, policy);

  const ref = db.collection(COLLECTIONS.assignments).doc();
  await ref.set({
    id: ref.id,
    classId: input.classId,
    groupId: input.groupId,
    caseStudyId: input.caseStudyId,
    caseVersionId: (caseSnapshot.get('currentVersionId') as string | undefined) ?? 'v1',
    policyId: policy.id,
    policyVersion: policy.version,
    rubricVersion: policy.rubric.version,
    presentationDate: new Date(presentationMs).toISOString(),
    submissionDeadline: new Date(deadlineMs).toISOString(),
    status: 'submission_open',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: actor.uid,
  });

  // The group is told in the same breath as the assignment is made. This is
  // the moment work starts existing for them, and the deadline with it.
  await notify({
    recipientUids: await groupMemberUids(input.classId, input.groupId),
    kind: 'assignment.created',
    params: { deadline: new Date(deadlineMs).toISOString() },
    href: `/classes/${input.classId}`,
  });

  await writeAuditLog({
    action: 'assignment.created',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.assignments}/${ref.id}`,
    classId: input.classId,
    after: {
      groupId: input.groupId,
      caseStudyId: input.caseStudyId,
      submissionDeadline: new Date(deadlineMs).toISOString(),
    },
  });

  return ref.id;
}

function parseAssignments(docs: FirebaseFirestore.QueryDocumentSnapshot[]): Assignment[] {
  return docs
    .map((doc) => assignmentSchema.safeParse(doc.data()))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);
}

export async function listAssignments(classId: string): Promise<Assignment[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.assignments)
    .where('classId', '==', classId)
    .get();
  return parseAssignments(snapshot.docs).sort((a, b) =>
    a.presentationDate.localeCompare(b.presentationDate),
  );
}

export async function listAssignmentsOfGroup(groupId: string): Promise<Assignment[]> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.assignments)
    .where('groupId', '==', groupId)
    .get();
  return parseAssignments(snapshot.docs);
}

export async function getAssignment(assignmentId: string): Promise<Assignment | null> {
  const snapshot = await getDb().collection(COLLECTIONS.assignments).doc(assignmentId).get();
  if (!snapshot.exists) return null;
  const parsed = assignmentSchema.safeParse(snapshot.data());
  return parsed.success ? parsed.data : null;
}

/**
 * Extending a deadline is a decision with consequences for fairness, so it is
 * recorded with who did it and why (SRS Module 08).
 */
export async function extendDeadline(
  actor: SessionUser,
  assignmentId: string,
  newDeadlineIso: string,
  reason: string,
): Promise<void> {
  const assignment = await getAssignment(assignmentId);
  if (!assignment) throw new AppError('NOT_FOUND', 'errors.assignmentNotFound');

  const newMs = Date.parse(newDeadlineIso);
  if (Number.isNaN(newMs)) throw new AppError('VALIDATION_FAILED', 'errors.dateInvalid');

  await getDb()
    .collection(COLLECTIONS.assignments)
    .doc(assignmentId)
    .update({
      submissionDeadline: new Date(newMs).toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    });

  await writeAuditLog({
    action: 'assignment.deadline_changed',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.assignments}/${assignmentId}`,
    classId: assignment.classId,
    before: { submissionDeadline: assignment.submissionDeadline },
    after: { submissionDeadline: new Date(newMs).toISOString() },
    reason,
  });
}

/** The deliverables a group still owes, from the policy the assignment froze. */
export function missingDeliverables(
  policyDeliverables: readonly Deliverable[],
  submittedDeliverableIds: readonly string[],
): Deliverable[] {
  const submitted = new Set(submittedDeliverableIds);
  return policyDeliverables.filter(
    (deliverable) => deliverable.required && !submitted.has(deliverable.id),
  );
}

/**
 * Whether a submission arriving now would be late, decided by the server's
 * clock. A student's device clock never takes part (SRS Module 08).
 */
export function lateAtServerTime(assignment: Assignment, now = Timestamp.now()): boolean {
  return isSubmissionLate(now.toMillis(), Date.parse(assignment.submissionDeadline));
}

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  assignmentSchema,
  isSubmissionLate,
  submissionDeadlineFor,
  type Assignment,
  type Deliverable,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { groupMemberUids, notify } from '../notifications/notifications';
import { policyOfAssignment, policyOfClass } from '../policy/policy-store';
import { linkClaimToAssignment } from '../case-selection/case-selection';
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
  const policy = await policyOfClass(input.classId);

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

  // A group that chose this case for itself has its claim marked as
  // scheduled, which is what stops the lecturer releasing it from under work
  // that now exists.
  await linkClaimToAssignment(input.classId, input.caseStudyId, ref.id);

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
  classId: string,
  assignmentId: string,
  newDeadlineIso: string,
  reason: string,
): Promise<void> {
  const assignment = await getAssignment(assignmentId);
  // Scoped to the class the caller was cleared for. Without this, permission
  // over one class would reach every assignment id in the system.
  if (!assignment || assignment.classId !== classId) {
    throw new AppError('NOT_FOUND', 'errors.assignmentNotFound');
  }

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

/**
 * Moves a presentation that has already been set to a new date.
 *
 * The submission deadline is recomputed rather than carried over, from the
 * policy version this assignment froze and not from whatever the class runs
 * under today: the two dates are one decision, and "24 hours before the
 * session" has to stay true of the framework this group's work is marked by.
 *
 * What it deliberately does not do is revisit the submissions already handed
 * in. Their `isLate` flag is a fact about the moment they arrived; recomputing
 * it here would turn work that was on time into work that was late because of
 * a decision taken afterwards. A group that needs relief from a deadline gets
 * it through `extendDeadline`, with its own reason.
 */
export async function reschedulePresentation(
  actor: SessionUser,
  classId: string,
  assignmentId: string,
  newPresentationDateIso: string,
  reason: string,
): Promise<{ presentationDate: string; submissionDeadline: string }> {
  const assignment = await getAssignment(assignmentId);
  // Scoped to the class the caller was cleared for, as above.
  if (!assignment || assignment.classId !== classId) {
    throw new AppError('NOT_FOUND', 'errors.assignmentNotFound');
  }
  if (reason.trim().length < 10) throw new AppError('VALIDATION_FAILED', 'errors.reasonTooShort');

  const presentationMs = Date.parse(newPresentationDateIso);
  if (Number.isNaN(presentationMs)) {
    throw new AppError('VALIDATION_FAILED', 'errors.dateInvalid');
  }
  if (presentationMs <= Date.now()) {
    throw new AppError('VALIDATION_FAILED', 'errors.presentationInPast');
  }

  const db = getDb();
  const [sessions, grades] = await Promise.all([
    db
      .collection(COLLECTIONS.presentationSessions)
      .where('assignmentId', '==', assignmentId)
      .limit(1)
      .get(),
    db.collection(COLLECTIONS.grades).where('assignmentId', '==', assignmentId).limit(1).get(),
  ]);

  // Marks are out. The deadline they were computed against - late penalty and
  // all - is part of a published result, so moving it now would change the
  // basis of a mark after the fact.
  if (!grades.empty) throw new AppError('CONFLICT', 'errors.gradeAlreadyPublished');

  // The room has opened. Whatever the calendar says, this presentation is
  // happening or has happened, and a date for it is no longer a plan.
  const session = sessions.docs[0];
  if (session && session.get('status') !== 'scheduled') {
    throw new AppError('CONFLICT', 'errors.presentationAlreadyRunning');
  }

  const policy = await policyOfAssignment(assignment);
  const presentationDate = new Date(presentationMs).toISOString();
  const submissionDeadline = new Date(submissionDeadlineFor(presentationMs, policy)).toISOString();
  if (presentationDate === assignment.presentationDate) {
    throw new AppError('VALIDATION_FAILED', 'errors.nothingToUpdate');
  }

  await db.collection(COLLECTIONS.assignments).doc(assignmentId).update({
    presentationDate,
    submissionDeadline,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // The group planned around the old date, so they are told about the new one
  // in the same breath - including the deadline, which moved with it.
  await notify({
    recipientUids: await groupMemberUids(assignment.classId, assignment.groupId),
    kind: 'assignment.rescheduled',
    params: { presentation: presentationDate, deadline: submissionDeadline },
    href: `/classes/${assignment.classId}`,
  });

  await writeAuditLog({
    action: 'assignment.rescheduled',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.assignments}/${assignmentId}`,
    classId: assignment.classId,
    before: {
      presentationDate: assignment.presentationDate,
      submissionDeadline: assignment.submissionDeadline,
    },
    after: { presentationDate, submissionDeadline },
    reason,
  });

  return { presentationDate, submissionDeadline };
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

import 'server-only';
import { AppError, findMembership, getAssignment, type SessionUser } from '@casestudyhub/core';
import type { Assignment } from '@casestudyhub/shared';

/**
 * Who may see an assignment and the work submitted against it: the members of
 * the group it was set for, and the staff running the class. Checked on the
 * server for every request, because a group's submissions are private to that
 * group (SRS 20).
 */
export async function assertCanAccessAssignment(
  caller: SessionUser,
  assignmentId: string,
): Promise<Assignment> {
  const assignment = await getAssignment(assignmentId);
  if (!assignment) throw new AppError('NOT_FOUND', 'errors.assignmentNotFound');

  if (caller.role === 'admin' || caller.role === 'lecturer') return assignment;

  const membership = await findMembership(assignment.classId, caller.uid);
  if (!membership || membership.groupId !== assignment.groupId) {
    throw new AppError('FORBIDDEN', 'errors.notYourAssignment');
  }
  return assignment;
}

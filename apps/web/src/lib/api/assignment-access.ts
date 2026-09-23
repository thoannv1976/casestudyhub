import 'server-only';
import {
  AppError,
  classIdsOfStudent,
  classMayViewSubmission,
  findMembership,
  getAssignment,
  type SessionUser,
} from '@casestudyhub/core';
import type { Assignment, Submission } from '@casestudyhub/shared';

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

/**
 * Reading one submitted file.
 *
 * The group and the staff may read anything the group handed in. The rest of
 * the class may read one thing and one thing only: the slide deck of the group
 * whose session has started, and only while they are in that class. That gap
 * exists so students can follow the slides on their own screen (SRS 10.1); it
 * is deliberately too narrow to reach the analysis report or the role
 * allocation sheet.
 */
export async function assertCanReadSubmission(
  caller: SessionUser,
  submission: Submission,
): Promise<void> {
  try {
    await assertCanAccessAssignment(caller, submission.assignmentId);
    return;
  } catch (error) {
    if (caller.role !== 'student') throw error;

    const visibility = await classMayViewSubmission(submission);
    if (!visibility.allowed || !visibility.classId) throw error;

    const classIds = await classIdsOfStudent(caller.uid);
    if (!classIds.includes(visibility.classId)) throw error;
  }
}

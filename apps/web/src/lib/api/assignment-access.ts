import 'server-only';
import {
  AppError,
  classIdsOfStudent,
  classMayViewSubmission,
  findMembership,
  getAssignment,
  projectTargetOf,
  type SessionUser,
} from '@casestudyhub/core';
import type { Submission } from '@casestudyhub/shared';

/** The little an access check needs, of either kind of work. */
export interface AccessibleWork {
  id: string;
  classId: string;
  groupId: string;
}

async function accessibleWork(id: string): Promise<AccessibleWork> {
  const project = await projectTargetOf(id);
  if (project) return { id: project.id, classId: project.classId, groupId: project.groupId };

  const assignment = await getAssignment(id);
  if (!assignment) throw new AppError('NOT_FOUND', 'errors.assignmentNotFound');
  return { id: assignment.id, classId: assignment.classId, groupId: assignment.groupId };
}

/**
 * Who may see a piece of work and what was submitted against it: the members
 * of the group it belongs to, and the staff running the class. Checked on the
 * server for every request, because a group's submissions are private to that
 * group (SRS 20).
 *
 * Takes either a case study assignment or the class group project. The two are
 * different pieces of work, but who may open them is the same question, and
 * asking it twice in two places is how the two answers drift apart.
 */
export async function assertCanAccessAssignment(
  caller: SessionUser,
  assignmentId: string,
): Promise<AccessibleWork> {
  const work = await accessibleWork(assignmentId);

  if (caller.role === 'admin' || caller.role === 'lecturer') return work;

  const membership = await findMembership(work.classId, caller.uid);
  if (!membership || membership.groupId !== work.groupId) {
    throw new AppError('FORBIDDEN', 'errors.notYourAssignment');
  }
  return work;
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

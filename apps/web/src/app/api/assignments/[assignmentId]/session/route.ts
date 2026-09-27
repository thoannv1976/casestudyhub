import { NextResponse, type NextRequest } from 'next/server';
import {
  AppError,
  assertCanManageClass,
  getAssignment,
  listProjectVolunteers,
  projectTargetOf,
  startSession,
} from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/** Opens the room for a group's presentation - a case study, or the project. */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ assignmentId: string }> },
) {
  try {
    const actor = await requirePermission('presentation.control');
    const { assignmentId } = await context.params;

    const project = await projectTargetOf(assignmentId);
    if (project) {
      await assertCanManageClass(actor, project.classId);
      // Only a group that put its hand up presents. Opening a room for a group
      // that never volunteered would let the class ask questions of a
      // presentation nobody agreed to give.
      const volunteers = await listProjectVolunteers(project.classId);
      if (!volunteers.some((row) => row.groupId === project.groupId)) {
        throw new AppError('POLICY_VIOLATION', 'errors.notVolunteered');
      }
    } else {
      const assignment = await getAssignment(assignmentId);
      if (!assignment) throw new AppError('NOT_FOUND', 'errors.assignmentNotFound');
      await assertCanManageClass(actor, assignment.classId);
    }

    const session = await startSession(actor, assignmentId);
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    return respondWithError(error);
  }
}

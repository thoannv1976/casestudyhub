import { NextResponse, type NextRequest } from 'next/server';
import { AppError, assertCanManageClass, getAssignment, startSession } from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/** Opens the room for a group's presentation. */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ assignmentId: string }> },
) {
  try {
    const actor = await requirePermission('presentation.control');
    const { assignmentId } = await context.params;

    const assignment = await getAssignment(assignmentId);
    if (!assignment) throw new AppError('NOT_FOUND', 'errors.assignmentNotFound');
    await assertCanManageClass(actor, assignment.classId);

    const session = await startSession(actor, assignmentId);
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    return respondWithError(error);
  }
}

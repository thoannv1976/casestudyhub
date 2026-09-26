import { NextResponse, type NextRequest } from 'next/server';
import {
  AppError,
  assertCanManageClass,
  assertCanViewClass,
  getClassProject,
  setProjectDeadline,
} from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/** The class group project: one per class, one deadline for every group. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    const caller = await requireSessionUser();
    const { classId } = await context.params;
    await assertCanViewClass(caller, classId);

    return NextResponse.json({ project: await getClassProject(classId) });
  } catch (error) {
    return respondWithError(error);
  }
}

/**
 * Sets the project, or moves its deadline. Recorded with who did it and why,
 * because a deadline decides whose work counts as late.
 */
export async function PUT(request: NextRequest, context: { params: Promise<{ classId: string }> }) {
  try {
    const actor = await requirePermission('assignment.manage');
    const { classId } = await context.params;
    await assertCanManageClass(actor, classId);

    const body = (await request.json()) as { deadline?: string; reason?: string };
    if (!body.deadline || !body.reason?.trim()) {
      throw new AppError('VALIDATION_FAILED', 'errors.reasonRequired');
    }

    const project = await setProjectDeadline(actor, classId, body.deadline, body.reason);
    return NextResponse.json({ project });
  } catch (error) {
    return respondWithError(error);
  }
}

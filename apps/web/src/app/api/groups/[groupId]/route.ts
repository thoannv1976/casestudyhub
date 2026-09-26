import { NextResponse, type NextRequest } from 'next/server';
import { AppError, assertCanManageClass, renameGroup } from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * Renames a group. Open to an admin and to the lecturers of that class, which
 * is what `class.manage` plus the class check means here; students reading the
 * same page never see the control and could not use it if they did.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    const actor = await requirePermission('class.manage');
    const { groupId } = await context.params;
    const body = (await request.json()) as { classId?: string; groupName?: string };

    if (!body.classId || !body.groupName) {
      throw new AppError('VALIDATION_FAILED', 'errors.validationFailed');
    }
    await assertCanManageClass(actor, body.classId);

    const groupName = await renameGroup(actor, body.classId, groupId, body.groupName);
    return NextResponse.json({ groupName });
  } catch (error) {
    return respondWithError(error);
  }
}

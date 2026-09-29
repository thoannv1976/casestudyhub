import { NextResponse, type NextRequest } from 'next/server';
import {
  AppError,
  assertCanManageClass,
  renameGroup,
  setGroupMaxMembers,
} from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * Renames a group, or changes how many members it holds. Open to an admin and to the lecturers of that class, which
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
    const body = (await request.json()) as {
      classId?: string;
      groupName?: string;
      maxMembers?: number;
    };

    if (!body.classId) throw new AppError('VALIDATION_FAILED', 'errors.validationFailed');
    await assertCanManageClass(actor, body.classId);

    // Two edits of the same group reach the same door. Which one it is comes
    // from what was sent, and sending neither is a malformed request.
    if (typeof body.maxMembers === 'number') {
      const maxMembers = await setGroupMaxMembers(actor, body.classId, groupId, body.maxMembers);
      return NextResponse.json({ maxMembers });
    }

    if (!body.groupName) throw new AppError('VALIDATION_FAILED', 'errors.validationFailed');
    const groupName = await renameGroup(actor, body.classId, groupId, body.groupName);
    return NextResponse.json({ groupName });
  } catch (error) {
    return respondWithError(error);
  }
}

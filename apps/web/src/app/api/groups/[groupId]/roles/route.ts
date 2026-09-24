import { NextResponse, type NextRequest } from 'next/server';
import { setRolesSchema } from '@casestudyhub/shared';
import {
  AppError,
  assertCanManageClass,
  autoAssignGroupRoles,
  setGroupLocked,
  setGroupRoles,
} from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * Role allocation for one group: automatic, manual, or locking the group.
 * The `action` in the body says which.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    const actor = await requirePermission('class.manage');
    const { groupId } = await context.params;
    const body = (await request.json()) as { classId?: string; action?: string; locked?: boolean };

    if (!body.classId) throw new AppError('VALIDATION_FAILED', 'errors.validationFailed');
    await assertCanManageClass(actor, body.classId);

    switch (body.action) {
      case 'auto': {
        const result = await autoAssignGroupRoles(actor, body.classId, groupId);
        return NextResponse.json(result);
      }
      case 'manual': {
        const input = setRolesSchema.parse(body);
        await setGroupRoles(actor, body.classId, groupId, input);
        return NextResponse.json({ ok: true });
      }
      case 'lock': {
        await setGroupLocked(actor, body.classId, groupId, body.locked === true);
        return NextResponse.json({ ok: true });
      }
      default:
        throw new AppError('VALIDATION_FAILED', 'errors.unknownKind');
    }
  } catch (error) {
    return respondWithError(error);
  }
}

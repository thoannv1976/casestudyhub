import { NextResponse, type NextRequest } from 'next/server';
import { removeEnrollmentSchema } from '@casestudyhub/shared';
import { assertCanManageClass, listRoster, removeFromClass } from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/** The class roster, for the lecturer who owns the class. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    const actor = await requirePermission('class.manage');
    const { classId } = await context.params;
    await assertCanManageClass(actor, classId);

    return NextResponse.json({ roster: await listRoster(classId) });
  } catch (error) {
    return respondWithError(error);
  }
}

/** Remove somebody who does not belong to the class; the row is kept. */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    const actor = await requirePermission('class.manage');
    const { classId } = await context.params;
    await assertCanManageClass(actor, classId);

    const { enrollmentId, reason } = removeEnrollmentSchema.parse(await request.json());
    await removeFromClass(actor, classId, enrollmentId, reason);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return respondWithError(error);
  }
}

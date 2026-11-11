import { NextResponse, type NextRequest } from 'next/server';
import { AppError, assertCanManageClass, remindMissingWork } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/** The lecturer reminds every group that still owes required work. */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    const actor = await requireSessionUser();
    if (actor.role !== 'lecturer' && actor.role !== 'admin')
      throw new AppError('FORBIDDEN', 'errors.forbidden');
    const { classId } = await context.params;
    await assertCanManageClass(actor, classId);
    return NextResponse.json(await remindMissingWork(actor, classId));
  } catch (error) {
    return respondWithError(error);
  }
}

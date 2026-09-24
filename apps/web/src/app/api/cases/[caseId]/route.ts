import { NextResponse, type NextRequest } from 'next/server';
import { setCaseStatusSchema } from '@casestudyhub/shared';
import { setCaseStatus } from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/** Publishing is what makes a case visible to students, so it needs the right. */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ caseId: string }> },
) {
  try {
    const actor = await requirePermission('case.publish');
    const { caseId } = await context.params;
    const { status } = setCaseStatusSchema.parse(await request.json());

    await setCaseStatus(actor, caseId, status);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return respondWithError(error);
  }
}

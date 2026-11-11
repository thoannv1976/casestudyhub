import { NextResponse, type NextRequest } from 'next/server';
import { cloneClassSchema } from '@casestudyhub/shared';
import { cloneClassForNewCohort } from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/** Opens a class for a new cohort from this one: same cases and settings, no people. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    const actor = await requirePermission('class.create');
    const { classId } = await context.params;
    const input = cloneClassSchema.parse(await request.json());
    const newClassId = await cloneClassForNewCohort(actor, classId, input);
    return NextResponse.json({ classId: newClassId }, { status: 201 });
  } catch (error) {
    return respondWithError(error);
  }
}

import { NextResponse, type NextRequest } from 'next/server';
import { caseSetRequestSchema } from '@casestudyhub/shared';
import {
  assertCanManageClass,
  caseSetOfClass,
  copyCaseSet,
  setClassCaseSet,
} from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * The lecturer saves the cases this class works from - picked one by one, or
 * copied whole from another class they teach.
 */
export async function PUT(request: NextRequest, context: { params: Promise<{ classId: string }> }) {
  try {
    const caller = await requireSessionUser();
    const { classId } = await context.params;
    await assertCanManageClass(caller, classId);

    const body = caseSetRequestSchema.parse(await request.json());
    if ('copyFromClassId' in body) {
      await copyCaseSet(caller, classId, body.copyFromClassId);
    } else {
      await setClassCaseSet(caller, classId, body);
    }
    // What was saved, so the page shows a copied set without a second read.
    return NextResponse.json({ set: await caseSetOfClass(classId) });
  } catch (error) {
    return respondWithError(error);
  }
}

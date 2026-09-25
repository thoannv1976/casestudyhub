import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  AppError,
  assertCanManageClass,
  assertCanViewClass,
  choosableCases,
  claimCase,
  releaseClaim,
  setCaseSelection,
} from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

const claimSchema = z.object({ caseStudyId: z.string().min(1) });
const releaseSchema = z.object({
  caseStudyId: z.string().min(1),
  reason: z.string().trim().min(3, 'errors.reasonRequired').max(500),
});
const modeSchema = z.object({
  mode: z.enum(['lecturer_assigns', 'groups_choose']),
  deadline: z.string().nullable().default(null),
});

/** Every published case, and which group in this class has taken each. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    const caller = await requireSessionUser();
    const { classId } = await context.params;
    await assertCanViewClass(caller, classId);

    return NextResponse.json({ cases: await choosableCases(classId) });
  } catch (error) {
    return respondWithError(error);
  }
}

/**
 * A group takes a case. Which group is read from the caller's membership
 * rather than the request: a student cannot choose on somebody else's behalf.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    const caller = await requireSessionUser();
    const { classId } = await context.params;
    const { caseStudyId } = claimSchema.parse(await request.json());

    return NextResponse.json({ claim: await claimCase(caller, classId, caseStudyId) });
  } catch (error) {
    return respondWithError(error);
  }
}

/** The lecturer opens or closes self-selection for the class. */
export async function PUT(request: NextRequest, context: { params: Promise<{ classId: string }> }) {
  try {
    const caller = await requireSessionUser();
    const { classId } = await context.params;
    await assertCanManageClass(caller, classId);

    const { mode, deadline } = modeSchema.parse(await request.json());
    await setCaseSelection(caller, classId, mode, deadline);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return respondWithError(error);
  }
}

/** The lecturer frees a case a group had taken. */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    const caller = await requireSessionUser();
    const { classId } = await context.params;
    await assertCanManageClass(caller, classId);

    const body: unknown = await request.json().catch(() => null);
    if (!body) throw new AppError('VALIDATION_FAILED', 'errors.validationFailed');

    const { caseStudyId, reason } = releaseSchema.parse(body);
    await releaseClaim(caller, classId, caseStudyId, reason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return respondWithError(error);
  }
}

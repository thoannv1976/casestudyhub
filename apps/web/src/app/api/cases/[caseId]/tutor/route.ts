import { NextResponse, type NextRequest } from 'next/server';
import { askTutorSchema } from '@casestudyhub/shared';
import {
  AiNotConfiguredError,
  AiResponseError,
  AppError,
  askTutor,
  assertCanReadCase,
  clearTutorSession,
  getCase,
  getTutorSession,
} from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function translated(error: unknown): unknown {
  if (error instanceof AiNotConfiguredError) {
    return new AppError('POLICY_VIOLATION', error.messageKey);
  }
  if (error instanceof AiResponseError) {
    console.error('AI response unusable:', error.message);
    return new AppError('INTERNAL', error.messageKey);
  }
  return error;
}

/** A tutor conversation belongs to one student; nobody else can read it. */
export async function GET(_request: NextRequest, context: { params: Promise<{ caseId: string }> }) {
  try {
    const caller = await requireSessionUser();
    const { caseId } = await context.params;

    const caseStudy = await getCase(caseId);
    if (!caseStudy) throw new AppError('NOT_FOUND', 'errors.caseNotFound');
    await assertCanReadCase(caller, caseStudy);

    return NextResponse.json({ session: await getTutorSession(caseId, caller.uid) });
  } catch (error) {
    return respondWithError(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ caseId: string }> }) {
  try {
    const caller = await requireSessionUser();
    const { caseId } = await context.params;

    const caseStudy = await getCase(caseId);
    if (!caseStudy) throw new AppError('NOT_FOUND', 'errors.caseNotFound');
    await assertCanReadCase(caller, caseStudy);

    const input = askTutorSchema.parse(await request.json());
    const session = await askTutor(caller, caseId, input.mode, input.message);

    return NextResponse.json({ session });
  } catch (error) {
    return respondWithError(translated(error));
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ caseId: string }> },
) {
  try {
    const caller = await requireSessionUser();
    const { caseId } = await context.params;
    await clearTutorSession(caseId, caller.uid);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return respondWithError(error);
  }
}

import { NextResponse, type NextRequest } from 'next/server';
import {
  AiNotConfiguredError,
  AiResponseError,
  AppError,
  answerQuestionBank,
  assertCanReadCase,
  getCase,
  listCaseQuestions,
} from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';
// Sixty questions in batches of ten is six round trips to a model.
export const maxDuration = 600;

/**
 * The case's question bank: everything every class ever asked about it, with
 * the answers. Students read it; only staff can ask the model to fill it in.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ caseId: string }> }) {
  try {
    const caller = await requireSessionUser();
    const { caseId } = await context.params;

    const caseStudy = await getCase(caseId);
    if (!caseStudy) throw new AppError('NOT_FOUND', 'errors.caseNotFound');
    await assertCanReadCase(caller, caseStudy);

    const isStaff = caller.role === 'admin' || caller.role === 'lecturer';
    const questions = await listCaseQuestions(caseId, { forOtherCohort: !isStaff });

    return NextResponse.json({ questions });
  } catch (error) {
    return respondWithError(error);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ caseId: string }> }) {
  try {
    const actor = await requirePermission('case.upload');
    const { caseId } = await context.params;

    const caseStudy = await getCase(caseId);
    if (!caseStudy) throw new AppError('NOT_FOUND', 'errors.caseNotFound');

    const body = (await request.json().catch(() => ({}))) as { limit?: number };
    const result = await answerQuestionBank(actor, caseId, {
      limit: typeof body.limit === 'number' ? Math.min(Math.max(body.limit, 1), 200) : undefined,
    });

    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof AiNotConfiguredError) {
      return respondWithError(new AppError('POLICY_VIOLATION', error.messageKey));
    }
    if (error instanceof AiResponseError) {
      console.error('AI response unusable:', error.message);
      return respondWithError(new AppError('INTERNAL', error.messageKey));
    }
    return respondWithError(error);
  }
}

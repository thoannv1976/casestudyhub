import { NextResponse, type NextRequest } from 'next/server';
import {
  AiNotConfiguredError,
  AiResponseError,
  AppError,
  getCase,
  suggestQuestions,
} from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Questions a lecturer might put to a presenting group. Shown on screen and
 * never written into the wall: a wall that fills itself is no longer the
 * class's.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ caseId: string }> },
) {
  try {
    const actor = await requirePermission('presentation.control');
    const { caseId } = await context.params;

    const caseStudy = await getCase(caseId);
    if (!caseStudy) throw new AppError('NOT_FOUND', 'errors.caseNotFound');

    return NextResponse.json({ questions: await suggestQuestions(actor, caseId) });
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

import { NextResponse, type NextRequest } from 'next/server';
import {
  AiBudgetSpentError,
  AiNotConfiguredError,
  AiResponseError,
  AppError,
  answerSessionQuestions,
  assertCanManageClass,
  clusterSessionQuestions,
  getQuestionClusters,
  getSession,
  sessionAskers,
} from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';
// A model reading a wall of sixty questions takes longer than a normal request.
export const maxDuration = 300;

function asAppError(error: unknown): unknown {
  if (error instanceof AiNotConfiguredError) {
    return new AppError('POLICY_VIOLATION', error.messageKey);
  }
  if (error instanceof AiBudgetSpentError) {
    return new AppError('POLICY_VIOLATION', error.messageKey);
  }
  if (error instanceof AiResponseError) {
    // The detail names a vendor endpoint and a status code; the lecturer gets a
    // message they can act on, and the detail goes to the server log.
    console.error('AI response unusable:', error.message);
    return new AppError('INTERNAL', error.messageKey);
  }
  return error;
}

async function classOfSession(sessionId: string): Promise<string> {
  const session = await getSession(sessionId);
  if (!session) throw new AppError('NOT_FOUND', 'errors.sessionNotFound');
  return session.classId;
}

/** Who still owes a question, and the grouping the model last proposed. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const actor = await requirePermission('grade.draft');
    const { sessionId } = await context.params;
    await assertCanManageClass(actor, await classOfSession(sessionId));

    return NextResponse.json({
      askers: await sessionAskers(sessionId),
      clusters: await getQuestionClusters(sessionId),
    });
  } catch (error) {
    return respondWithError(asAppError(error));
  }
}

/**
 * Two things the model can do with a wall of questions: answer the ones the
 * room never got to, and group them into themes. Both cost a call against the
 * month's budget, and neither changes a mark.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const actor = await requirePermission('grade.draft');
    const { sessionId } = await context.params;
    await assertCanManageClass(actor, await classOfSession(sessionId));

    const body = (await request.json().catch(() => ({}))) as { action?: string };

    if (body.action === 'cluster') {
      return NextResponse.json({ clusters: await clusterSessionQuestions(actor, sessionId) });
    }
    if (body.action === 'answer') {
      return NextResponse.json({ result: await answerSessionQuestions(actor, sessionId) });
    }

    throw new AppError('VALIDATION_FAILED', 'errors.unknownKind');
  } catch (error) {
    return respondWithError(asAppError(error));
  }
}

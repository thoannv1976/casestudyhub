import { NextResponse, type NextRequest } from 'next/server';
import {
  AiNotConfiguredError,
  AiResponseError,
  AppError,
  aiIsAvailable,
  assertCanManageClass,
  evaluateSubmission,
  getAiAssessment,
  getAssignment,
  projectTargetOf,
} from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';
// A model reading three documents takes longer than a normal request.
export const maxDuration = 300;

/**
 * Which class a piece of work belongs to, of either kind - a case study
 * assignment or the class group project. The model reads both, so the
 * permission check has to reach both.
 */
async function classOfWork(assignmentId: string): Promise<string> {
  const project = await projectTargetOf(assignmentId);
  if (project) return project.classId;

  const assignment = await getAssignment(assignmentId);
  if (!assignment) throw new AppError('NOT_FOUND', 'errors.assignmentNotFound');
  return assignment.classId;
}

function asAppError(error: unknown): unknown {
  if (error instanceof AiNotConfiguredError) {
    return new AppError('POLICY_VIOLATION', error.messageKey);
  }
  if (error instanceof AiResponseError) {
    // The detail names a vendor endpoint and a status code; the lecturer gets
    // a message they can act on, and the detail goes to the server log.
    console.error('AI response unusable:', error.message);
    return new AppError('INTERNAL', error.messageKey);
  }
  return error;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ assignmentId: string }> },
) {
  try {
    const actor = await requirePermission('grade.draft');
    const { assignmentId } = await context.params;

    await assertCanManageClass(actor, await classOfWork(assignmentId));

    return NextResponse.json({
      available: await aiIsAvailable(),
      assessment: await getAiAssessment(assignmentId),
    });
  } catch (error) {
    return respondWithError(error);
  }
}

/** Asks the model to read the case, the slides and the report, and suggest. */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ assignmentId: string }> },
) {
  try {
    const actor = await requirePermission('grade.draft');
    const { assignmentId } = await context.params;

    await assertCanManageClass(actor, await classOfWork(assignmentId));

    const assessment = await evaluateSubmission(actor, assignmentId);
    return NextResponse.json({ assessment }, { status: 201 });
  } catch (error) {
    return respondWithError(asAppError(error));
  }
}

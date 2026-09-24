import { NextResponse, type NextRequest } from 'next/server';
import { presentationRoleIdSchema } from '@casestudyhub/shared';
import {
  AppError,
  assertCanManageClass,
  getSession,
  pauseTimer,
  resumeTimer,
  setSessionStatus,
  setWindow,
  switchRole,
} from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * The lecturer's controls for a running session: the clock, whose turn it is,
 * and the two windows the class writes through.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const actor = await requirePermission('presentation.control');
    const { sessionId } = await context.params;

    const session = await getSession(sessionId);
    if (!session) throw new AppError('NOT_FOUND', 'errors.sessionNotFound');
    await assertCanManageClass(actor, session.classId);

    const body = (await request.json()) as {
      action?: string;
      roleId?: string;
      status?: string;
      window?: string;
      open?: boolean;
    };

    switch (body.action) {
      case 'pause':
        await pauseTimer(sessionId);
        break;
      case 'resume':
        await resumeTimer(sessionId);
        break;
      case 'switchRole':
        await switchRole(sessionId, presentationRoleIdSchema.parse(body.roleId));
        break;
      case 'status': {
        const status = body.status;
        if (status !== 'qa' && status !== 'review' && status !== 'completed' && status !== 'live') {
          throw new AppError('VALIDATION_FAILED', 'errors.statusInvalid');
        }
        await setSessionStatus(actor, sessionId, status);
        break;
      }
      case 'window': {
        if (body.window !== 'questions' && body.window !== 'peerReview') {
          throw new AppError('VALIDATION_FAILED', 'errors.validationFailed');
        }
        await setWindow(sessionId, body.window, body.open === true);
        break;
      }
      default:
        throw new AppError('VALIDATION_FAILED', 'errors.unknownKind');
    }

    return NextResponse.json({ session: await getSession(sessionId) });
  } catch (error) {
    return respondWithError(error);
  }
}

import { NextResponse, type NextRequest } from 'next/server';
import { AppError, isLtiEnabled, sendLtiClassGrades } from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * "Send the whole class to Moodle": every published mark of the class, to
 * every Moodle column linked to it. Publishing already sends as it goes; this
 * catches up students who joined from Moodle later, or a Hub outage.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    if (!isLtiEnabled()) throw new AppError('NOT_FOUND', 'errors.ltiNotEnabled');
    const actor = await requirePermission('grade.publish');
    const { classId } = await context.params;
    const outcome = await sendLtiClassGrades(actor, classId);
    return NextResponse.json(outcome);
  } catch (error) {
    return respondWithError(error);
  }
}

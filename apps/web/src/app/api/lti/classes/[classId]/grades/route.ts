import { NextResponse, type NextRequest } from 'next/server';
import {
  AppError,
  LTI_ACTIVITY_KINDS,
  isLtiEnabled,
  sendLtiClassGrades,
  type LtiActivityKind,
} from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/** An empty body sends every column; `{ "kinds": ["attendance"] }` only those. */
async function kindsOf(request: NextRequest): Promise<LtiActivityKind[] | undefined> {
  const text = await request.text();
  if (!text.trim()) return undefined;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AppError('VALIDATION_FAILED', 'errors.validationFailed');
  }
  const kinds = (body as { kinds?: unknown } | null)?.kinds;
  if (kinds === undefined) return undefined;
  if (
    !Array.isArray(kinds) ||
    kinds.length === 0 ||
    !kinds.every((kind) => (LTI_ACTIVITY_KINDS as readonly unknown[]).includes(kind))
  ) {
    throw new AppError('VALIDATION_FAILED', 'errors.validationFailed');
  }
  return kinds as LtiActivityKind[];
}

/**
 * "Send the whole class to Moodle": every published mark of the class, to
 * every Moodle column linked to it, and the attendance score to an attendance
 * column. Publishing already sends marks as it goes; this catches up students
 * who joined from Moodle later, or a Hub outage - and is the only way the
 * attendance score leaves.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    if (!isLtiEnabled()) throw new AppError('NOT_FOUND', 'errors.ltiNotEnabled');
    const actor = await requirePermission('grade.publish');
    const { classId } = await context.params;
    const kinds = await kindsOf(request);
    const outcome = await sendLtiClassGrades(actor, classId, undefined, kinds);
    return NextResponse.json(outcome);
  } catch (error) {
    return respondWithError(error);
  }
}

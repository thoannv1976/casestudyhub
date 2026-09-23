import { NextResponse, type NextRequest } from 'next/server';
import {
  AppError,
  assertCanManageClass,
  createAssignment,
  extendDeadline,
  listAssignments,
} from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    await requireSessionUser();
    const { classId } = await context.params;
    return NextResponse.json({ assignments: await listAssignments(classId) });
  } catch (error) {
    return respondWithError(error);
  }
}

/** Sets a case for a group, with the session date the deadline derives from. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    const actor = await requirePermission('assignment.manage');
    const { classId } = await context.params;
    await assertCanManageClass(actor, classId);

    const body = (await request.json()) as {
      groupId?: string;
      caseStudyId?: string;
      presentationDate?: string;
    };
    if (!body.groupId || !body.caseStudyId || !body.presentationDate) {
      throw new AppError('VALIDATION_FAILED', 'errors.validationFailed');
    }

    const assignmentId = await createAssignment(actor, {
      classId,
      groupId: body.groupId,
      caseStudyId: body.caseStudyId,
      presentationDate: body.presentationDate,
    });

    return NextResponse.json({ assignmentId }, { status: 201 });
  } catch (error) {
    return respondWithError(error);
  }
}

/** Extends a deadline. Recorded with who did it and why. */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    const actor = await requirePermission('assignment.manage');
    const { classId } = await context.params;
    await assertCanManageClass(actor, classId);

    const body = (await request.json()) as {
      assignmentId?: string;
      submissionDeadline?: string;
      reason?: string;
    };
    if (!body.assignmentId || !body.submissionDeadline || !body.reason?.trim()) {
      throw new AppError('VALIDATION_FAILED', 'errors.reasonRequired');
    }

    await extendDeadline(actor, body.assignmentId, body.submissionDeadline, body.reason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return respondWithError(error);
  }
}

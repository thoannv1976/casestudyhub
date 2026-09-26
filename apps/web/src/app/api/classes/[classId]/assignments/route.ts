import { NextResponse, type NextRequest } from 'next/server';
import {
  AppError,
  assertCanManageClass,
  assertCanViewClass,
  createAssignment,
  extendDeadline,
  listAssignments,
  reschedulePresentation,
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
    const caller = await requireSessionUser();
    const { classId } = await context.params;
    await assertCanViewClass(caller, classId);

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

/**
 * Changes a date on an assignment that has already been set. Either the
 * presentation itself - which moves the submission deadline with it, derived
 * from the policy the assignment froze - or the deadline alone, when a group
 * is being given relief without the session moving.
 *
 * Both are recorded with who did it and why.
 */
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
      presentationDate?: string;
      submissionDeadline?: string;
      reason?: string;
    };
    if (!body.assignmentId || !body.reason?.trim()) {
      throw new AppError('VALIDATION_FAILED', 'errors.reasonRequired');
    }

    if (body.presentationDate) {
      const moved = await reschedulePresentation(
        actor,
        classId,
        body.assignmentId,
        body.presentationDate,
        body.reason,
      );
      return NextResponse.json(moved);
    }

    if (!body.submissionDeadline) {
      throw new AppError('VALIDATION_FAILED', 'errors.validationFailed');
    }

    await extendDeadline(actor, classId, body.assignmentId, body.submissionDeadline, body.reason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return respondWithError(error);
  }
}

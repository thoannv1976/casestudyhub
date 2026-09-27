import { NextResponse, type NextRequest } from 'next/server';
import {
  AppError,
  assertCanManageClass,
  assertCanViewClass,
  findMembership,
  getClassProject,
  listProjectVolunteers,
  setProjectDeadline,
  setProjectPresentationSlots,
  volunteerToPresent,
  withdrawVolunteer,
} from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/** The class group project: one per class, one deadline for every group. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    const caller = await requireSessionUser();
    const { classId } = await context.params;
    await assertCanViewClass(caller, classId);

    const [project, volunteers] = await Promise.all([
      getClassProject(classId),
      listProjectVolunteers(classId),
    ]);
    return NextResponse.json({ project, volunteers });
  } catch (error) {
    return respondWithError(error);
  }
}

/**
 * Sets the project, or moves its deadline. Recorded with who did it and why,
 * because a deadline decides whose work counts as late.
 */
export async function PUT(request: NextRequest, context: { params: Promise<{ classId: string }> }) {
  try {
    const actor = await requirePermission('assignment.manage');
    const { classId } = await context.params;
    await assertCanManageClass(actor, classId);

    const body = (await request.json()) as { deadline?: string; reason?: string };
    if (!body.deadline || !body.reason?.trim()) {
      throw new AppError('VALIDATION_FAILED', 'errors.reasonRequired');
    }

    const project = await setProjectDeadline(actor, classId, body.deadline, body.reason);
    return NextResponse.json({ project });
  } catch (error) {
    return respondWithError(error);
  }
}

/**
 * Putting a hand up, and taking one down.
 *
 * A student volunteers for their own group and nobody else's; a lecturer
 * withdraws a group that changed its mind. Which of the two this is depends on
 * who is asking, not on what the body claims.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    const caller = await requireSessionUser();
    const { classId } = await context.params;
    const body = (await request.json()) as { action?: string; groupId?: string };

    if (body.action === 'withdraw') {
      const actor = await requirePermission('assignment.manage');
      await assertCanManageClass(actor, classId);
      if (!body.groupId) throw new AppError('VALIDATION_FAILED', 'errors.validationFailed');

      await withdrawVolunteer(actor, classId, body.groupId);
      return NextResponse.json({ volunteers: await listProjectVolunteers(classId) });
    }

    // Volunteering is the group's own act. The group comes from the caller's
    // membership, never from the request: otherwise one student could sign up
    // a group they do not belong to.
    if (caller.role !== 'student') {
      throw new AppError('FORBIDDEN', 'errors.onlyGroupMembersVolunteer');
    }
    await assertCanViewClass(caller, classId);

    const membership = await findMembership(classId, caller.uid);
    if (!membership) throw new AppError('POLICY_VIOLATION', 'errors.noGroupYet');

    const volunteer = await volunteerToPresent(caller, classId, membership.groupId);
    return NextResponse.json({ volunteer }, { status: 201 });
  } catch (error) {
    return respondWithError(error);
  }
}

/** How many groups may present, and by when they must say so. */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    const actor = await requirePermission('assignment.manage');
    const { classId } = await context.params;
    await assertCanManageClass(actor, classId);

    const body = (await request.json()) as { slots?: number; volunteerDeadline?: string };
    if (typeof body.slots !== 'number') {
      throw new AppError('VALIDATION_FAILED', 'errors.slotsInvalid');
    }

    const project = await setProjectPresentationSlots(
      actor,
      classId,
      body.slots,
      body.volunteerDeadline,
    );
    return NextResponse.json({ project });
  } catch (error) {
    return respondWithError(error);
  }
}

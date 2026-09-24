import { NextResponse, type NextRequest } from 'next/server';
import { assignMemberSchema } from '@casestudyhub/shared';
import {
  AppError,
  assertCanManageClass,
  assignMember,
  getUserProfile,
  joinGroup,
  listGroups,
  removeMember,
} from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

async function classOfGroup(groupId: string, classId: string) {
  const groups = await listGroups(classId);
  const group = groups.find((candidate) => candidate.id === groupId);
  if (!group) throw new AppError('NOT_FOUND', 'errors.groupNotFound');
  return group;
}

/**
 * A student joins a group themselves, or a lecturer places somebody into one.
 * Which of the two it is comes from the caller's role, never from the body.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    const caller = await requireSessionUser();
    const { groupId } = await context.params;
    const body = await request.json();
    const { classId } = body as { classId?: string };
    if (!classId) throw new AppError('VALIDATION_FAILED', 'errors.validationFailed');

    await classOfGroup(groupId, classId);

    if (caller.role === 'student') {
      const profile = await getUserProfile(caller.uid);
      if (!profile?.studentId) {
        throw new AppError('POLICY_VIOLATION', 'errors.studentIdRequiredToJoin');
      }
      await joinGroup(caller, classId, groupId, {
        studentId: profile.studentId,
        fullName: profile.fullName,
      });
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    await assertCanManageClass(caller, classId);
    const { studentUid } = assignMemberSchema.parse({ groupId, ...body });
    const profile = await getUserProfile(studentUid);
    if (!profile?.studentId) throw new AppError('NOT_FOUND', 'errors.userNotFound');

    await assignMember(caller, classId, groupId, studentUid, {
      studentId: profile.studentId,
      fullName: profile.fullName,
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return respondWithError(error);
  }
}

/** A lecturer takes a student out of their group. */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  try {
    const caller = await requireSessionUser();
    const { groupId } = await context.params;
    const { classId, studentUid } = (await request.json()) as {
      classId?: string;
      studentUid?: string;
    };
    if (!classId || !studentUid) throw new AppError('VALIDATION_FAILED', 'errors.validationFailed');

    await classOfGroup(groupId, classId);
    await assertCanManageClass(caller, classId);
    await removeMember(caller, classId, studentUid);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return respondWithError(error);
  }
}

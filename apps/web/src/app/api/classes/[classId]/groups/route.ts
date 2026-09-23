import { NextResponse, type NextRequest } from 'next/server';
import { createGroupsSchema } from '@casestudyhub/shared';
import {
  assertCanManageClass,
  createGroups,
  distributeRandomly,
  listGroups,
  listMembers,
  listRoster,
} from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/** Groups of a class, with their members. Any member of the class may look. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    await requireSessionUser();
    const { classId } = await context.params;
    const [groups, members] = await Promise.all([listGroups(classId), listMembers(classId)]);
    return NextResponse.json({ groups, members });
  } catch (error) {
    return respondWithError(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ classId: string }> },
) {
  try {
    const actor = await requirePermission('group.create');
    const { classId } = await context.params;
    await assertCanManageClass(actor, classId);

    const input = createGroupsSchema.parse(await request.json());
    const result = await createGroups(actor, classId, input);

    // Random grouping is only meaningful together with the groups it fills, so
    // the lecturer gets one action rather than two that must be run in order.
    if (input.formationMode === 'random') {
      const roster = await listRoster(classId);
      const candidates = roster
        .filter((row) => row.status === 'active' && row.studentUid)
        .map((row) => ({
          studentUid: row.studentUid as string,
          studentId: row.studentId,
          fullName: row.fullName,
        }));
      const distribution = await distributeRandomly(actor, classId, candidates);
      return NextResponse.json({ ...result, ...distribution }, { status: 201 });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return respondWithError(error);
  }
}

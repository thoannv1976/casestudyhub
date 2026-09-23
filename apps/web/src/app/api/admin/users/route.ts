import { NextResponse, type NextRequest } from 'next/server';
import { createStaffAccountSchema, setRoleSchema, setStatusSchema } from '@casestudyhub/shared';
import { createStaffAccount, listUsers, setUserRole, setUserStatus } from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requirePermission('user.manage');

    const role = request.nextUrl.searchParams.get('role');
    const search = request.nextUrl.searchParams.get('search');

    const users = await listUsers({
      role: role === 'admin' || role === 'lecturer' || role === 'student' ? role : undefined,
      search: search ?? undefined,
    });

    return NextResponse.json({ users });
  } catch (error) {
    return respondWithError(error);
  }
}

/** Creates a lecturer or admin account with a temporary password. */
export async function POST(request: NextRequest) {
  try {
    const actor = await requirePermission('user.manage');
    const input = createStaffAccountSchema.parse(await request.json());
    const { uid } = await createStaffAccount(actor, input);
    return NextResponse.json({ uid }, { status: 201 });
  } catch (error) {
    return respondWithError(error);
  }
}

/** Changes a role or a status. Both are audited and neither may target self. */
export async function PATCH(request: NextRequest) {
  try {
    const actor = await requirePermission('user.manage');
    const body = await request.json();

    if ('role' in body) {
      const { targetUid, role, reason } = setRoleSchema.parse(body);
      await setUserRole(actor, targetUid, role, reason);
    } else {
      const { targetUid, status, reason } = setStatusSchema.parse(body);
      await setUserStatus(actor, targetUid, status, reason);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return respondWithError(error);
  }
}

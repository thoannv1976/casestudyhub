import { NextResponse, type NextRequest } from 'next/server';
import {
  createAccountSchema,
  resetUserPasswordSchema,
  setRoleSchema,
  setStatusSchema,
  updateUserProfileSchema,
} from '@casestudyhub/shared';
import {
  createAccount,
  searchUsers,
  resetUserPassword,
  setUserRole,
  setUserStatus,
  updateUserByAdmin,
} from '@casestudyhub/core';
import { requirePermission } from '@casestudyhub/core/auth/authorize';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requirePermission('user.manage');

    const role = request.nextUrl.searchParams.get('role');
    const search = request.nextUrl.searchParams.get('search');

    const result = await searchUsers({
      role: role === 'admin' || role === 'lecturer' || role === 'student' ? role : undefined,
      search: search ?? undefined,
    });

    // `truncated` travels with the answer: a search that silently returned the
    // first page of a longer list would tell a lecturer somebody is not on the
    // platform when they are.
    return NextResponse.json(result);
  } catch (error) {
    return respondWithError(error);
  }
}

/** Creates an account of any role, with a temporary password to hand over. */
export async function POST(request: NextRequest) {
  try {
    const actor = await requirePermission('user.manage');
    const input = createAccountSchema.parse(await request.json());
    const { uid } = await createAccount(actor, input);
    return NextResponse.json({ uid }, { status: 201 });
  } catch (error) {
    return respondWithError(error);
  }
}

/**
 * The four things an administrator does to an existing account: change its
 * role, suspend or restore it, set a password for somebody who has lost
 * theirs, and correct a name. All four are audited and carry a reason, and
 * the first three refuse to target the caller.
 *
 * Which one is meant is read from the field that is present, so a body that
 * names none of them is a validation failure rather than a silent no-op.
 */
export async function PATCH(request: NextRequest) {
  try {
    const actor = await requirePermission('user.manage');
    const body: unknown = await request.json();
    const fields = typeof body === 'object' && body !== null ? body : {};

    if ('role' in fields) {
      const { targetUid, role, reason } = setRoleSchema.parse(body);
      await setUserRole(actor, targetUid, role, reason);
    } else if ('status' in fields) {
      const { targetUid, status, reason } = setStatusSchema.parse(body);
      await setUserStatus(actor, targetUid, status, reason);
    } else if ('temporaryPassword' in fields) {
      const { targetUid, temporaryPassword, reason } = resetUserPasswordSchema.parse(body);
      await resetUserPassword(actor, targetUid, temporaryPassword, reason);
    } else {
      const { targetUid, fullName, preferredLanguage, reason } =
        updateUserProfileSchema.parse(body);
      await updateUserByAdmin(actor, targetUid, { fullName, preferredLanguage }, reason);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return respondWithError(error);
  }
}

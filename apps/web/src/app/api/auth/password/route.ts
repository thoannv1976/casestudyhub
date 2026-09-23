import { NextResponse, type NextRequest } from 'next/server';
import { changePasswordSchema } from '@casestudyhub/shared';
import { SESSION_COOKIE_NAME, changeOwnPassword } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';
import { secureCookieFlag } from '@/lib/api/cookies';

export const dynamic = 'force-dynamic';

/**
 * Change your own password. Used both by an ordinary user and by staff forced
 * to replace the temporary password an admin handed them.
 */
export async function POST(request: NextRequest) {
  try {
    const caller = await requireSessionUser();
    const { newPassword } = changePasswordSchema.parse(await request.json());

    await changeOwnPassword(caller, newPassword);

    // Every session was revoked, this one included, so the cookie is dead and
    // the client signs in again with the new password.
    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: '',
      httpOnly: true,
      secure: secureCookieFlag(),
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return respondWithError(error);
  }
}

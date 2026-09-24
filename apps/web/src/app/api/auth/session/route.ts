import { NextResponse, type NextRequest } from 'next/server';
import { sessionRequestSchema } from '@casestudyhub/shared';
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS, createSessionCookie } from '@casestudyhub/core';
import { secureCookieFlag } from '@/lib/api/cookies';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/** Sign in: exchange a fresh Firebase ID token for a session cookie. */
export async function POST(request: NextRequest) {
  try {
    const { idToken } = sessionRequestSchema.parse(await request.json());
    const cookie = await createSessionCookie(idToken);

    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: cookie,
      httpOnly: true,
      secure: secureCookieFlag(),
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_MS / 1000,
    });
    return response;
  } catch (error) {
    return respondWithError(error);
  }
}

/**
 * Sign out: drop the cookie on this device.
 *
 * Deliberately does not revoke the user's sessions everywhere. A lecturer
 * running a live presentation from a laptop while holding a phone, or a
 * student on two devices, would otherwise be signed out of both by leaving
 * one. Revocation is reserved for the cases that need it - suspension and a
 * role change - where `setUserStatus` and `setUserRole` call it.
 */
export async function DELETE() {
  try {
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

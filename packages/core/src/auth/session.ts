import 'server-only';
import { cookies } from 'next/headers';
import { AppError } from '../errors';
import { SESSION_COOKIE_NAME, type SessionUser } from './types';
import { verifySessionCookie } from './tokens';

/**
 * Reading the session inside Next.js. The cookie is httpOnly, so no script on
 * the page can read it, and the server identifies the caller while rendering
 * rather than after hydration.
 */

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const cookie = store.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return null;
  return verifySessionCookie(cookie);
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AppError('UNAUTHENTICATED', 'errors.unauthenticated');
  return user;
}

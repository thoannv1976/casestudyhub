import type { UserRole } from '@casestudyhub/shared';
import { getAdminAuth } from '../firebase/admin';
import { AppError } from '../errors';
import { SESSION_MAX_AGE_MS, type SessionUser } from './types';

/**
 * Session tokens (SRS Module 01).
 *
 * The browser signs in with Firebase and receives a short-lived ID token. That
 * token is exchanged here for a session cookie signed by the Admin SDK, which
 * Server Components and route handlers can verify while rendering.
 *
 * This module deliberately knows nothing about Next.js, so the same logic is
 * available to the Phase 3 worker and to scripts.
 */

export async function createSessionCookie(idToken: string): Promise<string> {
  const auth = getAdminAuth();
  const decoded = await auth.verifyIdToken(idToken, true);

  // Accepting an old token would let one stolen minutes ago be upgraded into a
  // five-day session, so require a sign-in from the last five minutes.
  const signedInMs = decoded.auth_time * 1000;
  if (Date.now() - signedInMs > 5 * 60 * 1000) {
    throw new AppError('UNAUTHENTICATED', 'errors.staleSignIn');
  }

  const user = await auth.getUser(decoded.uid);
  if (user.disabled) {
    throw new AppError('FORBIDDEN', 'errors.accountSuspended');
  }

  return auth.createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_MS });
}

/**
 * Verifies a session cookie and returns the caller, or null for anything that
 * is expired, revoked, forged or carries no usable role.
 */
export async function verifySessionCookie(cookie: string): Promise<SessionUser | null> {
  try {
    // checkRevoked costs a lookup per request, and is what makes a suspended
    // account stop working at once rather than up to five days later.
    const decoded = await getAdminAuth().verifySessionCookie(cookie, true);
    const role = decoded.role as UserRole | undefined;
    if (role !== 'admin' && role !== 'lecturer' && role !== 'student') {
      return null;
    }
    return {
      uid: decoded.uid,
      email: decoded.email ?? '',
      role,
      preferredLanguage: decoded.preferredLanguage,
    };
  } catch {
    return null;
  }
}

/** Invalidates every session of a user: sign-out, suspension, role change. */
export async function revokeSessions(uid: string): Promise<void> {
  await getAdminAuth().revokeRefreshTokens(uid);
}

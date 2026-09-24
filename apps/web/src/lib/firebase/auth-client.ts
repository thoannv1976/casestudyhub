'use client';

import {
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type UserCredential,
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { getFirebaseAuth } from './client';

/**
 * Sign-in from the browser.
 *
 * Firebase verifies the password and returns an ID token; the server then
 * exchanges that token for the session cookie it can verify while rendering.
 * The password never reaches our own server.
 */

/** Maps a Firebase error to a message key, never leaking which part was wrong. */
export function authErrorKey(error: unknown): string {
  if (!(error instanceof FirebaseError)) return 'errors.unexpected';

  switch (error.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      // One message for all of these on purpose: distinguishing them would
      // tell an attacker which email addresses exist.
      return 'errors.wrongCredentials';
    case 'auth/too-many-requests':
      return 'errors.tooManyAttempts';
    case 'auth/user-disabled':
      return 'errors.accountSuspended';
    case 'auth/network-request-failed':
      return 'errors.networkError';
    default:
      return 'errors.unexpected';
  }
}

async function exchangeForSessionCookie(credential: UserCredential): Promise<void> {
  const idToken = await credential.user.getIdToken(true);

  const response = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.messageKey ?? 'errors.unexpected');
  }

  // The cookie is the session from here on; the client SDK has done its job.
  await firebaseSignOut(getFirebaseAuth());
}

export async function signInAndStartSession(email: string, password: string): Promise<void> {
  const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
  await exchangeForSessionCookie(credential);
}

export async function endSession(): Promise<void> {
  await fetch('/api/auth/session', { method: 'DELETE' });
}

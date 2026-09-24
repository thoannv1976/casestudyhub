/**
 * Whether the session cookie carries the Secure flag.
 *
 * Production always does. The one exception is a run against the Firebase
 * Emulator, which serves plain http: a Secure cookie would never be sent back,
 * and every signed-in test would fail for a reason that has nothing to do with
 * the code under test.
 */
export function secureCookieFlag(): boolean {
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST) {
    return false;
  }
  return process.env.NODE_ENV === 'production';
}

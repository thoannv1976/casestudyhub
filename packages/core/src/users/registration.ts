import { FieldValue } from 'firebase-admin/firestore';
import { FirebaseAuthError } from 'firebase-admin/auth';
import { COLLECTIONS, type Locale } from '@casestudyhub/shared';
import { getAdminAuth, getDb } from '../firebase/admin';
import { AppError } from '../errors';

/**
 * Student registration (SRS 1.1).
 *
 * Two identifiers are in play. The Firebase UID is the authentication
 * identity; the student id is a business code that must be unique across the
 * platform. Uniqueness is enforced by a document whose id *is* the student
 * code, written in the same transaction as the profile - a uniqueness check
 * done by querying first would let two simultaneous registrations both pass.
 */

export interface RegisterStudentInput {
  studentId: string;
  fullName: string;
  email: string;
  password: string;
  preferredLanguage: Locale;
}

/** Student ids differing only in case are the same code to a human. */
export function studentIdKey(studentId: string): string {
  return studentId.trim().toUpperCase();
}

export async function registerStudent(input: RegisterStudentInput): Promise<{ uid: string }> {
  const auth = getAdminAuth();
  const db = getDb();
  const key = studentIdKey(input.studentId);

  let uid: string;
  try {
    const record = await auth.createUser({
      email: input.email,
      password: input.password,
      displayName: input.fullName,
    });
    uid = record.uid;
  } catch (error) {
    if (error instanceof FirebaseAuthError && error.code === 'auth/email-already-exists') {
      throw new AppError('CONFLICT', 'errors.emailTaken');
    }
    if (error instanceof FirebaseAuthError && error.code === 'auth/invalid-password') {
      throw new AppError('VALIDATION_FAILED', 'errors.weakPassword');
    }
    throw error;
  }

  try {
    await db.runTransaction(async (tx) => {
      const indexRef = db.collection(COLLECTIONS.studentIdIndex).doc(key);
      const existing = await tx.get(indexRef);
      if (existing.exists) {
        throw new AppError('CONFLICT', 'errors.studentIdTaken', {
          details: { studentId: input.studentId },
        });
      }

      tx.create(indexRef, {
        uid,
        studentId: input.studentId,
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.create(db.collection(COLLECTIONS.users).doc(uid), {
        uid,
        studentId: input.studentId,
        fullName: input.fullName,
        email: input.email,
        globalRole: 'student',
        preferredLanguage: input.preferredLanguage,
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    await auth.setCustomUserClaims(uid, {
      role: 'student',
      preferredLanguage: input.preferredLanguage,
    });
  } catch (error) {
    // The profile did not land, so the auth account must not survive either -
    // otherwise the address is taken by an account that can sign in but has no
    // profile, and the student can never register again.
    await auth.deleteUser(uid).catch((cleanupError: unknown) => {
      // Rare, but it leaves an account that can sign in with no profile, so it
      // must be visible in the logs rather than swallowed.
      console.error(`Failed to remove the auth account ${uid} after a failed registration`, {
        cleanupError,
        cause: error,
      });
    });
    throw error;
  }

  return { uid };
}

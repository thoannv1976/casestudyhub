import { FieldValue } from 'firebase-admin/firestore';
import { FirebaseAuthError } from 'firebase-admin/auth';
import {
  COLLECTIONS,
  type CreateStaffAccountRequest,
  type UserProfile,
  userProfileSchema,
} from '@casestudyhub/shared';
import { getAdminAuth, getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { AppError } from '../errors';
import { revokeSessions } from '../auth/tokens';
import type { SessionUser } from '../auth/types';

/**
 * Staff accounts (SRS 3.1).
 *
 * An admin creates a lecturer or admin account with a temporary password and
 * hands it over directly. The password is marked `mustChangePassword`, so it
 * stops working as a credential the moment the owner signs in: it cannot
 * quietly become a shared password that several people know.
 */

export async function createStaffAccount(
  actor: SessionUser,
  input: CreateStaffAccountRequest,
): Promise<{ uid: string }> {
  const auth = getAdminAuth();
  const db = getDb();

  let uid: string;
  try {
    const record = await auth.createUser({
      email: input.email,
      password: input.temporaryPassword,
      displayName: input.fullName,
    });
    uid = record.uid;
  } catch (error) {
    if (error instanceof FirebaseAuthError && error.code === 'auth/email-already-exists') {
      throw new AppError('CONFLICT', 'errors.emailTaken');
    }
    throw error;
  }

  try {
    await db.collection(COLLECTIONS.users).doc(uid).create({
      uid,
      fullName: input.fullName,
      email: input.email,
      globalRole: input.role,
      preferredLanguage: input.preferredLanguage,
      status: 'active',
      mustChangePassword: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: actor.uid,
    });

    await auth.setCustomUserClaims(uid, {
      role: input.role,
      preferredLanguage: input.preferredLanguage,
      mustChangePassword: true,
    });
  } catch (error) {
    await auth.deleteUser(uid).catch((cleanupError: unknown) => {
      console.error(`Failed to remove the auth account ${uid} after a failed staff creation`, {
        cleanupError,
        cause: error,
      });
    });
    throw error;
  }

  await writeAuditLog({
    action: 'staff.account_created',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.users}/${uid}`,
    after: { email: input.email, globalRole: input.role },
  });

  return { uid };
}

/**
 * A user changes their own password.
 *
 * Other sessions are revoked: if the reason for changing is that somebody else
 * knows the old password, leaving their session alive defeats the change. The
 * caller's own session is re-established by the client straight afterwards.
 */
export async function changeOwnPassword(actor: SessionUser, newPassword: string): Promise<void> {
  const auth = getAdminAuth();

  await auth.updateUser(actor.uid, { password: newPassword });

  const user = await auth.getUser(actor.uid);
  const claims = { ...(user.customClaims ?? {}) };
  delete claims.mustChangePassword;
  await auth.setCustomUserClaims(actor.uid, claims);

  await getDb().collection(COLLECTIONS.users).doc(actor.uid).update({
    mustChangePassword: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await revokeSessions(actor.uid);

  await writeAuditLog({
    action: 'user.password_changed',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.users}/${actor.uid}`,
  });
}

export interface UserListFilters {
  role?: 'admin' | 'lecturer' | 'student';
  /** Matches a student code or an email exactly; both are unique. */
  search?: string;
  limit?: number;
}

export async function listUsers(filters: UserListFilters = {}): Promise<UserProfile[]> {
  const db = getDb();

  if (filters.search) {
    const term = filters.search.trim();
    const [byEmail, byStudentId] = await Promise.all([
      db.collection(COLLECTIONS.users).where('email', '==', term.toLowerCase()).limit(5).get(),
      db.collection(COLLECTIONS.users).where('studentId', '==', term).limit(5).get(),
    ]);
    const docs = [...byEmail.docs, ...byStudentId.docs];
    return docs
      .map((snapshot) => userProfileSchema.safeParse(snapshot.data()))
      .filter((parsed) => parsed.success)
      .map((parsed) => parsed.data);
  }

  let query = db.collection(COLLECTIONS.users).orderBy('createdAt', 'desc');
  if (filters.role) query = query.where('globalRole', '==', filters.role);

  const snapshot = await query.limit(filters.limit ?? 50).get();
  return snapshot.docs
    .map((docSnapshot) => userProfileSchema.safeParse(docSnapshot.data()))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);
}

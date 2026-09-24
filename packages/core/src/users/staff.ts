import { FieldValue } from 'firebase-admin/firestore';
import { FirebaseAuthError } from 'firebase-admin/auth';
import {
  COLLECTIONS,
  type CreateAccountRequest,
  type Locale,
  type UserProfile,
  userProfileSchema,
} from '@casestudyhub/shared';
import { getAdminAuth, getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { AppError } from '../errors';
import { revokeSessions } from '../auth/tokens';
import { registerStudent } from './registration';
import type { SessionUser } from '../auth/types';

/**
 * Accounts an administrator creates or repairs (SRS 3.1).
 *
 * An admin creates an account with a temporary password and hands it over
 * directly. The password is marked `mustChangePassword`, so it stops working
 * as a credential the moment the owner signs in: it cannot quietly become a
 * shared password that several people know.
 */

/**
 * Marks an account as owing a password change, in the claim the session cookie
 * carries and in the profile the interface reads. Both, because the layout
 * redirects on the claim and the administration table reads the profile - one
 * without the other is an account that looks fine and cannot be used, or the
 * reverse.
 */
async function markMustChangePassword(uid: string): Promise<void> {
  const auth = getAdminAuth();
  const user = await auth.getUser(uid);
  await auth.setCustomUserClaims(uid, { ...(user.customClaims ?? {}), mustChangePassword: true });
  await getDb().collection(COLLECTIONS.users).doc(uid).update({
    mustChangePassword: true,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function createAccount(
  actor: SessionUser,
  input: CreateAccountRequest,
): Promise<{ uid: string }> {
  // A student account is the same account a student would have made for
  // themselves, so it is made the same way - one transaction that claims the
  // student code, and one cleanup path if it fails. Writing a second version
  // of that here is how two accounts end up holding one code.
  if (input.role === 'student') {
    const { uid } = await registerStudent({
      studentId: input.studentId as string,
      fullName: input.fullName,
      email: input.email,
      password: input.temporaryPassword,
      preferredLanguage: input.preferredLanguage,
    });

    await markMustChangePassword(uid);

    await writeAuditLog({
      action: 'staff.account_created',
      actorUid: actor.uid,
      actorRole: actor.role,
      target: `${COLLECTIONS.users}/${uid}`,
      after: { email: input.email, globalRole: 'student', studentId: input.studentId },
    });

    return { uid };
  }

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

/**
 * An administrator sets somebody else's password.
 *
 * Before this there was no way back into an account whose password was lost:
 * no self-service reset, and nothing an administrator could do. A student who
 * forgot their password lost their coursework with it.
 *
 * Three things happen together, and all three are the point. The new password
 * is temporary - `mustChangePassword` means the person who typed it cannot go
 * on using it as a way in. Every session of that account is revoked, because
 * if the reason for the reset is that somebody else has the account, leaving
 * their session alive changes nothing. And the audit entry records an actor
 * who is not the target, which is what separates "they changed their own
 * password" from "an administrator set one for them" when somebody reads the
 * log back a year later.
 */
export async function resetUserPassword(
  actor: SessionUser,
  targetUid: string,
  temporaryPassword: string,
  reason: string,
): Promise<void> {
  // An administrator resetting their own password would skip the confirmation
  // the change-password page asks for. That page is the way to do it.
  if (actor.uid === targetUid) {
    throw new AppError('FORBIDDEN', 'errors.useOwnPasswordPage');
  }

  const ref = getDb().collection(COLLECTIONS.users).doc(targetUid);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new AppError('NOT_FOUND', 'errors.userNotFound');

  await getAdminAuth().updateUser(targetUid, { password: temporaryPassword });
  await markMustChangePassword(targetUid);
  await revokeSessions(targetUid);

  await writeAuditLog({
    action: 'user.password_changed',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.users}/${targetUid}`,
    // Never the password itself, in any form. What is worth recording is that
    // somebody else set one, and why.
    after: { resetByAdministrator: true, targetRole: snapshot.get('globalRole') as string },
    reason,
  });
}

/**
 * An administrator corrects a name or the language somebody reads in.
 *
 * Not the email address: that is how the account signs in, and changing it
 * from here would lock somebody out of their own coursework with no way to
 * tell them. Not the student code either - a roster is matched against it, so
 * changing it silently moves somebody between classes.
 */
export async function updateUserByAdmin(
  actor: SessionUser,
  targetUid: string,
  update: { fullName: string; preferredLanguage: Locale },
  reason: string,
): Promise<void> {
  const ref = getDb().collection(COLLECTIONS.users).doc(targetUid);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new AppError('NOT_FOUND', 'errors.userNotFound');

  const before = {
    fullName: snapshot.get('fullName') as string,
    preferredLanguage: snapshot.get('preferredLanguage') as string,
  };
  if (
    before.fullName === update.fullName &&
    before.preferredLanguage === update.preferredLanguage
  ) {
    return;
  }

  const auth = getAdminAuth();
  const user = await auth.getUser(targetUid);
  await auth.updateUser(targetUid, { displayName: update.fullName });
  // The language lives in the claim too, because the sign-in redirect reads it
  // before any profile has been loaded.
  await auth.setCustomUserClaims(targetUid, {
    ...(user.customClaims ?? {}),
    preferredLanguage: update.preferredLanguage,
  });

  await ref.update({
    fullName: update.fullName,
    preferredLanguage: update.preferredLanguage,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeAuditLog({
    action: 'user.profile_corrected',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.users}/${targetUid}`,
    before,
    after: update,
    reason,
  });
}

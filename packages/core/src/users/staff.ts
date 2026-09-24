import { randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { FirebaseAuthError } from 'firebase-admin/auth';
import {
  COLLECTIONS,
  matchesSearch,
  type ImportedStudent,
  type CreateAccountRequest,
  type Locale,
  type UserProfile,
  userProfileSchema,
} from '@casestudyhub/shared';
import { getAdminAuth, getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { AppError } from '../errors';
import { revokeSessions } from '../auth/tokens';
import { registerStudent, studentIdKey } from './registration';
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

/**
 * How many accounts a search reads before giving up.
 *
 * Searching happens in memory rather than through an index, deliberately.
 * Firestore has no substring search, and the search that matters here is for
 * a Vietnamese name somebody typed without diacritics - "nguyen van a" must
 * find "Nguyễn Văn A". No index does that; an index would need a second,
 * folded copy of every name, kept in step for ever, and it would still only
 * match from the start of the string.
 *
 * A faculty has hundreds of accounts, not millions, so reading them is the
 * cheaper answer by a wide margin. If this platform ever holds more than this
 * many, the search says so rather than quietly returning the first thousand.
 */
const SEARCH_SCAN_LIMIT = 2_000;

export interface UserSearchResult {
  users: UserProfile[];
  /** True when the scan hit its limit, so the answer may be incomplete. */
  truncated: boolean;
}

export async function searchUsers(filters: UserListFilters = {}): Promise<UserSearchResult> {
  const db = getDb();

  let query = db.collection(COLLECTIONS.users).orderBy('createdAt', 'desc');
  if (filters.role) query = query.where('globalRole', '==', filters.role);

  const scanning = Boolean(filters.search?.trim());
  const snapshot = await query.limit(scanning ? SEARCH_SCAN_LIMIT : (filters.limit ?? 50)).get();

  const users = snapshot.docs
    .map((docSnapshot) => userProfileSchema.safeParse(docSnapshot.data()))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data)
    .filter((user) => !filters.search || matchesSearch(user, filters.search));

  return {
    users: users.slice(0, filters.limit ?? 50),
    truncated: scanning && snapshot.size === SEARCH_SCAN_LIMIT,
  };
}

export async function listUsers(filters: UserListFilters = {}): Promise<UserProfile[]> {
  return (await searchUsers(filters)).users;
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

/**
 * A temporary password for somebody who is not in the room.
 *
 * Generated on the server with a real random source, and handed back exactly
 * once, in the response to the import that created it. It is never stored in
 * readable form and cannot be retrieved afterwards - an administrator who
 * loses the list resets the accounts individually, which is the same work but
 * with an audit entry per person.
 */
function temporaryPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
  const digits = '23456789';
  const bytes = randomBytes(11);
  const pick = (from: string, offset: number, count: number) =>
    Array.from({ length: count }, (_, index) => from[bytes[offset + index]! % from.length]).join(
      '',
    );
  return `${pick(letters, 0, 8)}${pick(digits, 8, 3)}`;
}

export interface ImportedAccount {
  studentId: string;
  fullName: string;
  email: string;
  /** Shown once, to be handed over. Never stored in this form. */
  temporaryPassword: string;
}

export interface AccountImportOutcome {
  created: ImportedAccount[];
  /** Rows that already had an account, with the reason they were left alone. */
  skipped: { studentId: string; messageKey: string }[];
}

/**
 * Creates accounts for a list of students who cannot register themselves.
 *
 * Existing accounts are left completely alone - not updated, not given a new
 * password. An import that reset the passwords of everybody already on the
 * platform, because a file was uploaded twice, would be a very bad afternoon.
 */
export async function importAccounts(
  actor: SessionUser,
  students: readonly ImportedStudent[],
  options: { dryRun?: boolean } = {},
): Promise<AccountImportOutcome> {
  const outcome: AccountImportOutcome = { created: [], skipped: [] };
  const db = getDb();

  for (const student of students) {
    const key = studentIdKey(student.studentId);
    const claimed = await db.collection(COLLECTIONS.studentIdIndex).doc(key).get();
    if (claimed.exists) {
      outcome.skipped.push({ studentId: student.studentId, messageKey: 'errors.studentIdTaken' });
      continue;
    }

    const password = temporaryPassword();
    if (options.dryRun) {
      // The password shown in a preview is thrown away with it: the account is
      // created on the real run, with a different one.
      outcome.created.push({ ...student, temporaryPassword: '' });
      continue;
    }

    try {
      const { uid } = await registerStudent({
        studentId: student.studentId,
        fullName: student.fullName,
        email: student.email,
        password,
        preferredLanguage: 'vi',
      });
      await markMustChangePassword(uid);
      outcome.created.push({ ...student, temporaryPassword: password });
    } catch (error) {
      outcome.skipped.push({
        studentId: student.studentId,
        messageKey: error instanceof AppError ? error.messageKey : 'errors.unexpected',
      });
    }
  }

  if (!options.dryRun && outcome.created.length > 0) {
    await writeAuditLog({
      action: 'user.imported',
      actorUid: actor.uid,
      actorRole: actor.role,
      target: COLLECTIONS.users,
      // The passwords are not in the log, and never will be.
      after: { created: outcome.created.length, skipped: outcome.skipped.length },
    });
  }

  return outcome;
}

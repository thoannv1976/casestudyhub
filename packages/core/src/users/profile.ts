import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  localeSchema,
  userProfileSchema,
  type Locale,
  type UserProfile,
  type UserRole,
} from '@casestudyhub/shared';
import { getAdminAuth, getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import { AppError } from '../errors';
import { revokeSessions } from '../auth/tokens';
import type { SessionUser } from '../auth/types';

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snapshot = await getDb().collection(COLLECTIONS.users).doc(uid).get();
  if (!snapshot.exists) return null;

  const parsed = userProfileSchema.safeParse(snapshot.data());
  if (!parsed.success) {
    throw new AppError('INTERNAL', 'errors.corruptProfile', {
      message: `Profile ${uid} does not match the schema`,
      details: { issues: parsed.error.issues.map((issue) => issue.path.join('.')) },
    });
  }
  return parsed.data;
}

export interface ProfileUpdate {
  fullName?: string;
  preferredLanguage?: Locale;
}

/**
 * A user edits their own name and language. Role, status, email and student id
 * are deliberately not updatable here - they move through admin endpoints that
 * write an audit log, and Firestore rules reject them from the client as well.
 */
export async function updateOwnProfile(uid: string, update: ProfileUpdate): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (update.fullName !== undefined) patch.fullName = update.fullName;
  if (update.preferredLanguage !== undefined) {
    patch.preferredLanguage = localeSchema.parse(update.preferredLanguage);
  }

  await getDb().collection(COLLECTIONS.users).doc(uid).update(patch);

  if (update.preferredLanguage) {
    const auth = getAdminAuth();
    const user = await auth.getUser(uid);
    await auth.setCustomUserClaims(uid, {
      ...(user.customClaims ?? {}),
      preferredLanguage: update.preferredLanguage,
    });
  }
}

/** Changing a role is an administrative act: audited, and never self-served. */
export async function setUserRole(
  actor: SessionUser,
  targetUid: string,
  role: UserRole,
  reason: string,
): Promise<void> {
  if (actor.uid === targetUid) {
    throw new AppError('FORBIDDEN', 'errors.cannotChangeOwnRole');
  }

  const db = getDb();
  const ref = db.collection(COLLECTIONS.users).doc(targetUid);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new AppError('NOT_FOUND', 'errors.userNotFound');

  const previousRole = snapshot.get('globalRole') as UserRole;
  if (previousRole === role) return;

  const auth = getAdminAuth();
  const user = await auth.getUser(targetUid);
  await auth.setCustomUserClaims(targetUid, { ...(user.customClaims ?? {}), role });
  await ref.update({ globalRole: role, updatedAt: FieldValue.serverTimestamp() });

  // Claims live inside the session cookie, so an existing session would keep
  // the old role until it expired. Revoking forces a fresh sign-in.
  await revokeSessions(targetUid);

  await writeAuditLog({
    action: 'user.role_changed',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.users}/${targetUid}`,
    before: { globalRole: previousRole },
    after: { globalRole: role },
    reason,
  });
}

/** Suspending an account stops it immediately, in Auth and in the profile. */
export async function setUserStatus(
  actor: SessionUser,
  targetUid: string,
  status: 'active' | 'suspended',
  reason: string,
): Promise<void> {
  if (actor.uid === targetUid) {
    throw new AppError('FORBIDDEN', 'errors.cannotSuspendSelf');
  }

  const db = getDb();
  const ref = db.collection(COLLECTIONS.users).doc(targetUid);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new AppError('NOT_FOUND', 'errors.userNotFound');

  const before = snapshot.get('status') as string;
  await getAdminAuth().updateUser(targetUid, { disabled: status === 'suspended' });
  await ref.update({ status, updatedAt: FieldValue.serverTimestamp() });
  if (status === 'suspended') await revokeSessions(targetUid);

  await writeAuditLog({
    action: 'user.status_changed',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.users}/${targetUid}`,
    before: { status: before },
    after: { status },
    reason,
  });
}

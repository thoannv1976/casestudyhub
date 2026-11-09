import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { FirebaseAuthError } from 'firebase-admin/auth';
import { COLLECTIONS, type Locale, type UserRole } from '@casestudyhub/shared';
import { getAdminAuth, getDb } from '../firebase/admin';
import { AppError } from '../errors';
import { writeAuditLog } from '../audit/audit-log';
import { enrollmentId } from '../academic/enrollment';
import { registerStudentFromLms } from '../users/registration';
import { ltiConfig } from './config';
import { verifyLaunchTicket, type LaunchContext } from './hub-sdk';
import {
  alternativeStudentId,
  ltiActivityKind,
  ltiContextKey,
  ltiResourceKey,
  placeholderEmail,
  studentIdFromLms,
} from './keys';

/**
 * Opening the platform from Moodle (through UniGame Hub, LTI 1.3).
 *
 * The Hub has already authenticated the person with Moodle and hands over a
 * signed, single-use ticket. This module turns it into an account here, a
 * class, and - for a student - a place to send their mark. It never grants a
 * role: a Moodle teacher becomes a lecturer here only if an admin already made
 * them one, because the right to publish marks is the one thing an LMS role
 * must not be able to mint.
 */

/** A lecturer's unfinished link expires: the choice is made in the same sitting. */
const PENDING_TTL_MS = 2 * 60 * 60 * 1000;

export interface LtiLaunchResult {
  /** Firebase custom token; the browser exchanges it for the session cookie. */
  customToken: string;
  /** Path (without locale) to open after sign-in. */
  next: string;
}

/** Verifies the Hub's ticket and marks it used, so a copied link cannot sign anyone in twice. */
export async function verifyLtiTicket(ticket: string): Promise<LaunchContext> {
  const config = ltiConfig();
  try {
    return await verifyLaunchTicket(ticket, {
      hubUrl: config.hubUrl,
      gameId: config.gameId,
      markUsed: async (jti, expiresAt) => {
        try {
          await getDb()
            .collection(COLLECTIONS.ltiUsedTickets)
            .doc(jti)
            .create({
              usedAt: FieldValue.serverTimestamp(),
              expiresAt: Timestamp.fromDate(expiresAt),
            });
          return true;
        } catch (error) {
          // `create` failing because the document exists IS the replay check.
          const code = (error as { code?: unknown }).code;
          if (code === 6 || code === 'already-exists') return false;
          throw error;
        }
      },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('UNAUTHENTICATED', 'errors.ltiTicketInvalid', { cause: error });
  }
}

function localeOf(ctx: LaunchContext): Locale {
  return ctx.locale?.toLowerCase().startsWith('en') ? 'en' : 'vi';
}

function displayNameOf(ctx: LaunchContext): string {
  const parts = [ctx.givenName, ctx.familyName].filter(Boolean).join(' ').trim();
  return (ctx.name?.trim() || parts || ctx.username || 'Moodle').slice(0, 120);
}

interface ResolvedAccount {
  uid: string;
  role: UserRole;
  studentId?: string;
  fullName: string;
  email: string;
}

async function accountOf(uid: string): Promise<ResolvedAccount | null> {
  const snapshot = await getDb().collection(COLLECTIONS.users).doc(uid).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as Record<string, unknown>;
  if (data.status !== 'active') throw new AppError('FORBIDDEN', 'errors.accountSuspended');
  const auth = await getAdminAuth().getUser(uid);
  if (auth.disabled) throw new AppError('FORBIDDEN', 'errors.accountSuspended');
  return {
    uid,
    role: data.globalRole as UserRole,
    ...(typeof data.studentId === 'string' ? { studentId: data.studentId } : {}),
    fullName: String(data.fullName ?? ''),
    email: String(data.email ?? ''),
  };
}

async function uidByEmail(email: string): Promise<string | null> {
  try {
    return (await getAdminAuth().getUserByEmail(email)).uid;
  } catch (error) {
    if (error instanceof FirebaseAuthError && error.code === 'auth/user-not-found') return null;
    throw error;
  }
}

/** A new student account; the student code is the Moodle username when it is free. */
async function createStudentFor(ctx: LaunchContext): Promise<string> {
  const base = studentIdFromLms({
    ...(ctx.username ? { username: ctx.username } : {}),
    ...(ctx.email ? { email: ctx.email } : {}),
    hubUserId: ctx.hubUserId,
  });
  const input = {
    fullName: displayNameOf(ctx),
    email: ctx.email?.trim().toLowerCase() || placeholderEmail(ctx.hubUserId),
    preferredLanguage: localeOf(ctx),
  };

  for (const studentId of [base, alternativeStudentId(base, ctx.hubUserId)]) {
    try {
      return (await registerStudentFromLms({ ...input, studentId })).uid;
    } catch (error) {
      if (error instanceof AppError && error.messageKey === 'errors.studentIdTaken') continue;
      // Lost a race with a second launch of the same person: use that account.
      if (error instanceof AppError && error.messageKey === 'errors.emailTaken') {
        const uid = await uidByEmail(input.email);
        if (uid) return uid;
      }
      throw error;
    }
  }
  throw new AppError('CONFLICT', 'errors.studentIdTaken');
}

/**
 * Which account a Moodle user is here: the one they were linked to before,
 * else the one with their e-mail, else - students only - a new one.
 */
async function resolveAccount(ctx: LaunchContext): Promise<ResolvedAccount> {
  const db = getDb();
  const mappingRef = db.collection(COLLECTIONS.ltiUsers).doc(ctx.hubUserId);
  const mapping = await mappingRef.get();

  let account: ResolvedAccount | null = null;
  let via: 'mapping' | 'email' | 'created' = 'mapping';

  if (mapping.exists) account = await accountOf(mapping.get('uid') as string);

  if (!account && ctx.email) {
    const uid = await uidByEmail(ctx.email.trim().toLowerCase());
    if (uid) {
      account = await accountOf(uid);
      via = 'email';
    }
  }

  if (!account) {
    if (ctx.role === 'instructor') throw new AppError('FORBIDDEN', 'errors.ltiLecturerNotFound');
    account = await accountOf(await createStudentFor(ctx));
    via = 'created';
    if (!account) throw new AppError('INTERNAL', 'errors.unexpected');
  }

  if (ctx.role === 'instructor' && account.role !== 'lecturer' && account.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'errors.ltiLecturerNotFound');
  }

  await mappingRef.set({
    hubUserId: ctx.hubUserId,
    uid: account.uid,
    tenantId: ctx.tenantId,
    username: ctx.username ?? null,
    email: ctx.email ?? null,
    lmsRole: ctx.role,
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (!mapping.exists || mapping.get('uid') !== account.uid) {
    await writeAuditLog({
      action: 'lti.account_linked',
      actorUid: account.uid,
      actorRole: account.role,
      target: `${COLLECTIONS.users}/${account.uid}`,
      after: { via, tenantId: ctx.tenantId, lmsRole: ctx.role },
    });
  }
  return account;
}

/**
 * A student opening the class from Moodle is a member of it: the LMS course
 * already says so, and the lecturer chose to link it. A student the lecturer
 * removed stays removed - Moodle cannot readmit them.
 */
async function ensureEnrolled(account: ResolvedAccount, classId: string): Promise<void> {
  if (!account.studentId) throw new AppError('POLICY_VIOLATION', 'errors.studentIdRequiredToJoin');
  const db = getDb();
  const classRef = db.collection(COLLECTIONS.classes).doc(classId);
  const ref = db
    .collection(COLLECTIONS.classEnrollments)
    .doc(enrollmentId(classId, account.studentId));

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      const status = existing.get('status') as string;
      const holderUid = existing.get('studentUid') as string | undefined;
      if (status === 'removed') throw new AppError('FORBIDDEN', 'errors.removedFromClass');
      if (holderUid && holderUid !== account.uid) {
        throw new AppError('CONFLICT', 'errors.studentIdClaimed');
      }
      if (holderUid === account.uid && status === 'active') return;

      tx.update(ref, {
        studentUid: account.uid,
        fullName: account.fullName,
        email: account.email,
        status: 'active',
        joinedVia: 'lti',
        joinedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (status !== 'active') tx.update(classRef, { studentCount: FieldValue.increment(1) });
      return;
    }

    tx.create(ref, {
      id: ref.id,
      classId,
      studentId: account.studentId,
      studentUid: account.uid,
      fullName: account.fullName,
      email: account.email,
      status: 'active',
      joinedVia: 'lti',
      joinedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(classRef, { studentCount: FieldValue.increment(1) });
  });
}

/** Handles a verified launch: who this is, which class, where to go. */
export async function handleLtiLaunch(ctx: LaunchContext): Promise<LtiLaunchResult> {
  const config = ltiConfig();
  if (config.tenants.length > 0 && !config.tenants.includes(ctx.tenantId)) {
    throw new AppError('FORBIDDEN', 'errors.ltiTenantNotAllowed');
  }
  if (!ctx.context?.id) throw new AppError('VALIDATION_FAILED', 'errors.ltiNoCourse');

  const db = getDb();
  const account = await resolveAccount(ctx);
  const contextKey = ltiContextKey({
    tenantId: ctx.tenantId,
    issuer: ctx.platform.issuer,
    contextId: ctx.context.id,
  });
  const link = await db.collection(COLLECTIONS.ltiContexts).doc(contextKey).get();
  const customToken = await getAdminAuth().createCustomToken(account.uid);
  const isStaff = account.role === 'lecturer' || account.role === 'admin';

  if (!link.exists) {
    if (ctx.role !== 'instructor') throw new AppError('CONFLICT', 'errors.ltiClassNotLinked');
    await db
      .collection(COLLECTIONS.ltiPending)
      .doc(contextKey)
      .set({
        key: contextKey,
        tenantId: ctx.tenantId,
        issuer: ctx.platform.issuer,
        contextId: ctx.context.id,
        title: ctx.context.title ?? null,
        label: ctx.context.label ?? null,
        uid: account.uid,
        expiresAt: Timestamp.fromMillis(Date.now() + PENDING_TTL_MS),
      });
    return { customToken, next: `/lti/link?key=${contextKey}` };
  }

  const classId = link.get('classId') as string;
  const classDoc = await db.collection(COLLECTIONS.classes).doc(classId).get();
  if (!classDoc.exists) throw new AppError('NOT_FOUND', 'errors.classNotFound');
  if (classDoc.get('status') !== 'active') {
    throw new AppError('POLICY_VIOLATION', 'errors.classNotActive');
  }

  const kind = ltiActivityKind(ctx.activity);
  const resourceKey = ltiResourceKey({
    tenantId: ctx.tenantId,
    issuer: ctx.platform.issuer,
    resourceLinkId: ctx.resourceLink.id,
  });
  await db
    .collection(COLLECTIONS.ltiActivities)
    .doc(resourceKey)
    .set(
      {
        key: resourceKey,
        contextKey,
        classId,
        kind,
        title: ctx.resourceLink.title ?? null,
        ...(ctx.linkTarget ? { linkTarget: ctx.linkTarget } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  if (isStaff) {
    const lecturerIds = (classDoc.get('lecturerIds') as string[] | undefined) ?? [];
    const teaches = account.role === 'admin' || lecturerIds.includes(account.uid);
    if (ctx.role === 'instructor' && !teaches)
      throw new AppError('FORBIDDEN', 'errors.notYourClass');
    return { customToken, next: teaches ? `/teaching/${classId}` : '/dashboard' };
  }

  await ensureEnrolled(account, classId);
  if (ctx.gradeTarget && kind !== 'class') {
    await db.collection(COLLECTIONS.ltiGradeTargets).doc(`${account.uid}__${resourceKey}`).set({
      uid: account.uid,
      hubUserId: ctx.hubUserId,
      resourceKey,
      classId,
      kind,
      gradeTarget: ctx.gradeTarget,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  return { customToken, next: `/classes/${classId}` };
}

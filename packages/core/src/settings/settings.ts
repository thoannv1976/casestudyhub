import { FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  DEFAULT_SYSTEM_SETTINGS,
  SYSTEM_SETTINGS_ID,
  aiUsageSchema,
  systemSettingsSchema,
  usagePeriodOf,
  type AiUsage,
  type SystemSettings,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { writeAuditLog } from '../audit/audit-log';
import type { SessionUser } from '../auth/types';

/**
 * Platform settings and what the model has cost so far (SRS Module 03).
 *
 * Read fresh every time, deliberately. The obvious thing is to cache this for
 * a minute - it is read on the registration page and on every upload. It was
 * cached, and the end-to-end suite caught what that costs: Next.js splits the
 * server build into chunks, so a route handler and a page hold *different*
 * copies of this module. Clearing the cache after a save cleared it in the
 * handler that saved and nowhere else, and an administrator who closed
 * registration watched the form stay open.
 *
 * None of the paths that read this are hot - a registration, an import, a
 * model call - so one document read is the right price for a setting that
 * means what it says the moment it is saved.
 */

/** Kept for tests, which have nothing to clear but say so explicitly. */
export function clearSettingsCache(): void {
  // Nothing is cached. See above.
}

export async function getSystemSettings(): Promise<SystemSettings> {
  const snapshot = await getDb()
    .collection(COLLECTIONS.systemSettings)
    .doc(SYSTEM_SETTINGS_ID)
    .get();

  // A deployment that has never been configured runs on the defaults rather
  // than failing: nothing here is required for the platform to work.
  const parsed = systemSettingsSchema.safeParse(snapshot.data() ?? {});
  return parsed.success ? parsed.data : DEFAULT_SYSTEM_SETTINGS;
}

export async function saveSystemSettings(
  actor: SessionUser,
  settings: SystemSettings,
  reason: string,
): Promise<void> {
  const before = await getSystemSettings();

  await getDb()
    .collection(COLLECTIONS.systemSettings)
    .doc(SYSTEM_SETTINGS_ID)
    .set({ ...settings, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid });

  await writeAuditLog({
    action: 'system.setting_changed',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.systemSettings}/${SYSTEM_SETTINGS_ID}`,
    before,
    after: settings,
    reason,
  });
}

/** What the model has been asked to do this month, and what it produced. */
export async function aiUsageOf(period: string): Promise<AiUsage> {
  const snapshot = await getDb().collection(COLLECTIONS.aiUsage).doc(period).get();
  const parsed = aiUsageSchema.safeParse({ period, ...snapshot.data() });
  return parsed.success ? parsed.data : { period, calls: 0, promptTokens: 0, outputTokens: 0 };
}

export async function currentAiUsage(now = Date.now()): Promise<AiUsage> {
  return aiUsageOf(usagePeriodOf(now));
}

/**
 * Counts one model call against the month.
 *
 * Written after the call, not before: a call that failed cost nothing and
 * should not eat the budget. The consequence is that a burst of parallel
 * calls can cross the budget by however many were already in flight, which is
 * the right trade - a budget exists to stop a runaway, not to be exact to the
 * single call.
 */
export async function recordAiCall(
  usage: { promptTokens: number; outputTokens: number },
  now = Date.now(),
): Promise<void> {
  const period = usagePeriodOf(now);
  await getDb()
    .collection(COLLECTIONS.aiUsage)
    .doc(period)
    .set(
      {
        period,
        calls: FieldValue.increment(1),
        promptTokens: FieldValue.increment(usage.promptTokens),
        outputTokens: FieldValue.increment(usage.outputTokens),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

export interface PlatformMetrics {
  users: { admin: number; lecturer: number; student: number; suspended: number };
  classes: { active: number };
  sessions: { live: number; completed: number };
  submissions: number;
  grades: { published: number };
  ai: AiUsage & { budget: number };
}

/**
 * What the platform holds, for the administrator who is responsible for it
 * (SRS Module 03).
 *
 * Counted with aggregate queries rather than by reading the documents: the
 * answer is a number, and a page that had to read every submission to say how
 * many there are would get slower every week it was used.
 */
export async function platformMetrics(now = Date.now()): Promise<PlatformMetrics> {
  const db = getDb();
  const count = async (query: FirebaseFirestore.Query): Promise<number> =>
    (await query.count().get()).data().count;

  const [
    admin,
    lecturer,
    student,
    suspended,
    activeClasses,
    liveSessions,
    completedSessions,
    submissions,
    publishedGrades,
    settings,
    usage,
  ] = await Promise.all([
    count(db.collection(COLLECTIONS.users).where('globalRole', '==', 'admin')),
    count(db.collection(COLLECTIONS.users).where('globalRole', '==', 'lecturer')),
    count(db.collection(COLLECTIONS.users).where('globalRole', '==', 'student')),
    count(db.collection(COLLECTIONS.users).where('status', '==', 'suspended')),
    count(db.collection(COLLECTIONS.classes).where('status', '==', 'active')),
    count(db.collection(COLLECTIONS.presentationSessions).where('status', '==', 'live')),
    count(db.collection(COLLECTIONS.presentationSessions).where('status', '==', 'completed')),
    count(db.collection(COLLECTIONS.submissions)),
    count(db.collection(COLLECTIONS.grades).where('status', '==', 'published')),
    getSystemSettings(),
    currentAiUsage(now),
  ]);

  return {
    users: { admin, lecturer, student, suspended },
    classes: { active: activeClasses },
    sessions: { live: liveSessions, completed: completedSessions },
    submissions,
    grades: { published: publishedGrades },
    ai: { ...usage, budget: settings.aiMonthlyCallBudget },
  };
}

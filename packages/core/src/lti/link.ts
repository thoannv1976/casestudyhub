import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { AppError } from '../errors';
import { writeAuditLog } from '../audit/audit-log';
import type { SessionUser } from '../auth/types';
import {
  assertCanManageClass,
  listAllClasses,
  listClassesOfLecturer,
  type ClassSummary,
} from '../academic/structure';
import type { LtiActivityKind } from './keys';

/**
 * Linking a Moodle course to a class (decided once, by a lecturer).
 *
 * One Moodle course is one class here: every activity added to that course
 * opens the same class, and its students are that class's students. The link
 * is made from the pending record the lecturer's own launch left behind, so
 * nobody can link a course they did not open from Moodle.
 */

export interface LtiPendingLink {
  key: string;
  courseTitle: string;
  /** Active classes the caller may link the course to. */
  classes: ClassSummary[];
}

async function pendingFor(actor: SessionUser, key: string) {
  const snapshot = await getDb().collection(COLLECTIONS.ltiPending).doc(key).get();
  if (!snapshot.exists) throw new AppError('NOT_FOUND', 'errors.ltiLinkExpired');
  const data = snapshot.data() as Record<string, unknown>;
  const expiresAt = (data.expiresAt as FirebaseFirestore.Timestamp | undefined)?.toMillis() ?? 0;
  if (expiresAt < Date.now()) throw new AppError('NOT_FOUND', 'errors.ltiLinkExpired');
  if (data.uid !== actor.uid && actor.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'errors.ltiLinkExpired');
  }
  return { ref: snapshot.ref, data };
}

export async function getLtiPendingLink(actor: SessionUser, key: string): Promise<LtiPendingLink> {
  if (actor.role !== 'lecturer' && actor.role !== 'admin')
    throw new AppError('FORBIDDEN', 'errors.forbidden');
  const { data } = await pendingFor(actor, key);
  const classes =
    actor.role === 'admin' ? await listAllClasses(200) : await listClassesOfLecturer(actor.uid);
  return {
    key,
    courseTitle: String(data.title ?? data.label ?? ''),
    classes: classes
      .filter((item) => item.status === 'active')
      .sort((a, b) => a.className.localeCompare(b.className)),
  };
}

export async function linkLtiCourse(
  actor: SessionUser,
  key: string,
  classId: string,
): Promise<void> {
  if (actor.role !== 'lecturer' && actor.role !== 'admin')
    throw new AppError('FORBIDDEN', 'errors.forbidden');
  const { ref, data } = await pendingFor(actor, key);
  await assertCanManageClass(actor, classId);

  const db = getDb();
  const classDoc = await db.collection(COLLECTIONS.classes).doc(classId).get();
  if (classDoc.get('status') !== 'active')
    throw new AppError('POLICY_VIOLATION', 'errors.classNotActive');

  await db
    .collection(COLLECTIONS.ltiContexts)
    .doc(key)
    .set({
      key,
      tenantId: data.tenantId,
      issuer: data.issuer,
      contextId: data.contextId,
      title: data.title ?? null,
      label: data.label ?? null,
      classId,
      linkedByUid: actor.uid,
      linkedAt: FieldValue.serverTimestamp(),
    });
  await ref.delete();

  await writeAuditLog({
    action: 'lti.class_linked',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.ltiContexts}/${key}`,
    classId,
    after: { course: data.title ?? data.label ?? null },
  });
}

/**
 * Students who came in from Moodle, and how many of them the class did not
 * already know. A course linked to the right class mostly brings people who
 * are on its roster; a course linked to last year's class brings strangers.
 */
export interface LtiRosterMatch {
  fromMoodle: number;
  /** Came from Moodle and were not on the class roster before. */
  newFromMoodle: number;
  /** Active students who joined some other way (class code, import, by hand). */
  joinedOtherwise: number;
  /** Most people Moodle brings are strangers to a class that has its own roster. */
  likelyWrongClass: boolean;
}

/** Enrolments the launch created rather than matched: created together with the join. */
const SAME_MOMENT_MS = 60_000;

const millis = (value: unknown): number | null =>
  value && typeof (value as FirebaseFirestore.Timestamp).toMillis === 'function'
    ? (value as FirebaseFirestore.Timestamp).toMillis()
    : null;

export async function ltiRosterMatch(classId: string): Promise<LtiRosterMatch> {
  const rows = await getDb()
    .collection(COLLECTIONS.classEnrollments)
    .where('classId', '==', classId)
    .get();
  let fromMoodle = 0;
  let newFromMoodle = 0;
  let joinedOtherwise = 0;
  for (const doc of rows.docs) {
    if (doc.get('status') !== 'active') continue;
    if (doc.get('joinedVia') !== 'lti') {
      joinedOtherwise += 1;
      continue;
    }
    fromMoodle += 1;
    const created = millis(doc.get('createdAt'));
    const joined = millis(doc.get('joinedAt'));
    if (created !== null && joined !== null && Math.abs(joined - created) < SAME_MOMENT_MS) {
      newFromMoodle += 1;
    }
  }
  return {
    fromMoodle,
    newFromMoodle,
    joinedOtherwise,
    likelyWrongClass: joinedOtherwise >= 5 && newFromMoodle >= 2 && newFromMoodle * 2 > fromMoodle,
  };
}

/**
 * Points a linked Moodle course at another class: for a new cohort, or to undo
 * a link made to the wrong class. Every activity of that course follows, and
 * so does where each student's mark goes. Refused once the old class has
 * published marks, so two cohorts' marks never share one gradebook column.
 */
export async function relinkLtiCourse(
  actor: SessionUser,
  key: string,
  toClassId: string,
): Promise<{ activities: number }> {
  if (actor.role !== 'lecturer' && actor.role !== 'admin')
    throw new AppError('FORBIDDEN', 'errors.forbidden');
  const db = getDb();
  const contextRef = db.collection(COLLECTIONS.ltiContexts).doc(key);
  const context = await contextRef.get();
  if (!context.exists) throw new AppError('NOT_FOUND', 'errors.notFound');
  const fromClassId = String(context.get('classId'));
  if (fromClassId === toClassId) return { activities: 0 };

  await assertCanManageClass(actor, fromClassId);
  await assertCanManageClass(actor, toClassId);
  const target = await db.collection(COLLECTIONS.classes).doc(toClassId).get();
  if (target.get('status') !== 'active')
    throw new AppError('POLICY_VIOLATION', 'errors.classNotActive');

  // One field only, filtered here: a class has a few dozen assessments at most.
  const assessments = await db
    .collection(COLLECTIONS.lecturerAssessments)
    .where('classId', '==', fromClassId)
    .get();
  if (assessments.docs.some((doc) => doc.get('status') === 'published'))
    throw new AppError('POLICY_VIOLATION', 'errors.ltiRelinkHasGrades');

  const activities = await db
    .collection(COLLECTIONS.ltiActivities)
    .where('contextKey', '==', key)
    .get();
  const resourceKeys = new Set(activities.docs.map((doc) => doc.id));
  const targets = await db
    .collection(COLLECTIONS.ltiGradeTargets)
    .where('classId', '==', fromClassId)
    .get();

  const writer = db.bulkWriter();
  writer.update(contextRef, {
    classId: toClassId,
    previousClassIds: FieldValue.arrayUnion(fromClassId),
    relinkedByUid: actor.uid,
    relinkedAt: FieldValue.serverTimestamp(),
  });
  for (const doc of activities.docs) writer.update(doc.ref, { classId: toClassId });
  for (const doc of targets.docs) {
    if (resourceKeys.has(String(doc.get('resourceKey'))))
      writer.update(doc.ref, { classId: toClassId });
  }
  await writer.close();

  await writeAuditLog({
    action: 'lti.class_relinked',
    actorUid: actor.uid,
    actorRole: actor.role,
    target: `${COLLECTIONS.ltiContexts}/${key}`,
    classId: toClassId,
    before: { classId: fromClassId },
    after: { classId: toClassId, course: context.get('title') ?? context.get('label') ?? null },
  });
  return { activities: activities.size };
}

export interface LtiClassLinks {
  courses: { key: string; title: string }[];
  activities: { key: string; title: string; kind: LtiActivityKind; hasColumn: boolean }[];
  roster: LtiRosterMatch;
}

/** What of this class is reachable from Moodle, for the lecturer's panel. */
export async function ltiLinksOfClass(classId: string): Promise<LtiClassLinks> {
  const db = getDb();
  const [courses, activities, roster] = await Promise.all([
    db.collection(COLLECTIONS.ltiContexts).where('classId', '==', classId).get(),
    db.collection(COLLECTIONS.ltiActivities).where('classId', '==', classId).get(),
    ltiRosterMatch(classId),
  ]);
  return {
    roster,
    courses: courses.docs.map((doc) => ({
      key: doc.id,
      title: String(doc.get('title') ?? doc.get('label') ?? ''),
    })),
    activities: activities.docs.map((doc) => ({
      key: doc.id,
      title: String(doc.get('title') ?? ''),
      kind: doc.get('kind') as LtiActivityKind,
      hasColumn: typeof doc.get('linkTarget') === 'string',
    })),
  };
}

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

export interface LtiClassLinks {
  courses: { key: string; title: string }[];
  activities: { key: string; title: string; kind: LtiActivityKind; hasColumn: boolean }[];
}

/** What of this class is reachable from Moodle, for the lecturer's panel. */
export async function ltiLinksOfClass(classId: string): Promise<LtiClassLinks> {
  const db = getDb();
  const [courses, activities] = await Promise.all([
    db.collection(COLLECTIONS.ltiContexts).where('classId', '==', classId).get(),
    db.collection(COLLECTIONS.ltiActivities).where('classId', '==', classId).get(),
  ]);
  return {
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

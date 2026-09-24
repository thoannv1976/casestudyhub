import {
  COLLECTIONS,
  DEFAULT_PRESENTATION_POLICY,
  NOTIFICATION_PAGE_SIZE,
  dueSoonNotification,
  notificationSchema,
  sortForReading,
  type AppNotification,
  type NotificationKind,
} from '@casestudyhub/shared';
import { getDb } from '../firebase/admin';
import { listClassesOfStudent } from '../academic/enrollment';
import { listAssignments, missingDeliverables } from '../assignments/assignments';
import { listMembers } from '../groups/groups';
import { currentVersions, listSubmissions } from '../submissions/submissions';
import { getCase } from '../cases/cases';

/**
 * Notifications (SRS Module 15).
 *
 * Written at the moment the thing happens, by the same server action that did
 * it - a mark is published and the people it belongs to are told in the same
 * breath. Nothing polls for changes to decide what to announce.
 *
 * The one exception is the deadline warning, which is computed when the list
 * is read. That is deliberate: it needs no scheduler, and it stops saying
 * "due soon" the moment the work is handed in.
 */

export interface NotifyInput {
  recipientUids: readonly string[];
  kind: NotificationKind;
  params?: Record<string, string | number>;
  href: string;
}

/** Tells several people the same thing, in one batch. */
export async function notify(input: NotifyInput): Promise<number> {
  const recipients = [...new Set(input.recipientUids)].filter(Boolean);
  if (recipients.length === 0) return 0;

  const db = getDb();
  const batch = db.batch();
  const createdAt = new Date().toISOString();

  for (const recipientUid of recipients) {
    const ref = db.collection(COLLECTIONS.notifications).doc();
    batch.set(ref, {
      id: ref.id,
      recipientUid,
      kind: input.kind,
      params: input.params ?? {},
      href: input.href,
      createdAt,
    });
  }

  await batch.commit();
  return recipients.length;
}

/** Everyone in a group, which is who most of these are addressed to. */
export async function groupMemberUids(classId: string, groupId: string): Promise<string[]> {
  const members = await listMembers(classId);
  return members.filter((member) => member.groupId === groupId).map((member) => member.studentUid);
}

async function storedFor(uid: string): Promise<AppNotification[]> {
  // Ordered explicitly: with a bare limit Firestore returns the first
  // documents by id, which for random ids means an arbitrary handful rather
  // than the recent ones. This pairs with the composite index on
  // (recipientUid, createdAt DESC).
  const snapshot = await getDb()
    .collection(COLLECTIONS.notifications)
    .where('recipientUid', '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(NOTIFICATION_PAGE_SIZE)
    .get();

  return snapshot.docs
    .map((doc) => notificationSchema.safeParse(doc.data()))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);
}

/**
 * The deadline warnings this person would want right now.
 *
 * Only for the group they actually belong to, and only while something is
 * still missing: a group that has handed everything in is not behind on
 * anything, whatever the clock says.
 */
async function dueSoonFor(uid: string, nowMs: number): Promise<AppNotification[]> {
  const enrollments = (await listClassesOfStudent(uid)).filter(
    (enrollment) => enrollment.status === 'active',
  );

  const derived: AppNotification[] = [];

  for (const enrollment of enrollments) {
    const members = await listMembers(enrollment.classId);
    const membership = members.find((member) => member.studentUid === uid);
    if (!membership) continue;

    const assignments = (await listAssignments(enrollment.classId)).filter(
      (assignment) => assignment.groupId === membership.groupId,
    );

    for (const assignment of assignments) {
      const submissions = currentVersions(await listSubmissions(assignment.id));
      const missing = missingDeliverables(
        DEFAULT_PRESENTATION_POLICY.deliverables,
        submissions.map((submission) => submission.deliverableId),
      );
      if (missing.length === 0) continue;

      const caseStudy = await getCase(assignment.caseStudyId);
      const notification = dueSoonNotification(
        {
          assignmentId: assignment.id,
          classId: enrollment.classId,
          caseTitle: caseStudy?.title ?? assignment.caseStudyId,
          submissionDeadline: assignment.submissionDeadline,
          missingDeliverables: missing.length,
        },
        uid,
        nowMs,
      );
      if (notification) derived.push(notification);
    }
  }

  return derived;
}

export async function listNotifications(
  uid: string,
  options: { now?: number } = {},
): Promise<AppNotification[]> {
  const nowMs = options.now ?? Date.now();
  const [stored, derived] = await Promise.all([storedFor(uid), dueSoonFor(uid, nowMs)]);
  return sortForReading([...derived, ...stored]).slice(0, NOTIFICATION_PAGE_SIZE);
}

/**
 * Marks everything stored as read. The derived deadline warnings are not
 * stored and therefore cannot be dismissed - they go when the work goes in,
 * which is the only thing that should make them go.
 */
export async function markAllRead(uid: string): Promise<number> {
  const db = getDb();
  const snapshot = await db
    .collection(COLLECTIONS.notifications)
    .where('recipientUid', '==', uid)
    .get();

  const unread = snapshot.docs.filter((doc) => !doc.get('readAt'));
  if (unread.length === 0) return 0;

  const readAt = new Date().toISOString();
  const batch = db.batch();
  for (const doc of unread) batch.update(doc.ref, { readAt });
  await batch.commit();

  return unread.length;
}

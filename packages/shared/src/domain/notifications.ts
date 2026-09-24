import { z } from 'zod';

/**
 * Notifications (SRS Module 15).
 *
 * A notification stores a message *key* and its parameters, never a rendered
 * sentence. The platform is bilingual and a student may switch language at any
 * time: a Vietnamese sentence written into the database in March would still
 * be Vietnamese when an English reader opens it in June.
 *
 * Nothing here pushes. These are read when somebody opens the app, which is
 * also why the one time-based alert in this file is derived at read time
 * rather than written by a scheduler that does not exist.
 */

export const NOTIFICATION_KINDS = [
  /** A case was set for your group, with a deadline. */
  'assignment.created',
  /** The lecturer let you into a class you asked to join. */
  'enrollment.approved',
  /** The presenting group chose your question to answer aloud. */
  'question.selected',
  /** Your mark has been published. */
  'grade.published',
  /**
   * Derived at read time, never stored: a deliverable is still missing and the
   * deadline is close. Storing it would need a scheduler, and a stored one
   * would go on saying "due soon" after the work was handed in.
   */
  'submission.dueSoon',
] as const;
export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const notificationSchema = z.object({
  id: z.string().min(1),
  recipientUid: z.string().min(1),
  kind: notificationKindSchema,
  /** Rendered by the interface, in whichever language the reader is using. */
  params: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  /** Where this takes the reader, relative to the locale root. */
  href: z.string().min(1),
  createdAt: z.string().min(1),
  readAt: z.string().optional(),
});
export type AppNotification = z.infer<typeof notificationSchema>;

/** How many are kept per person; older ones are not worth a query. */
export const NOTIFICATION_PAGE_SIZE = 30;

/**
 * How close a deadline has to be before it is worth saying anything. A day is
 * long enough to still do something about it, short enough not to nag for a
 * fortnight.
 */
export const DUE_SOON_HOURS = 48;

export interface DueSoonInput {
  assignmentId: string;
  classId: string;
  caseTitle: string;
  /** ISO timestamp of the submission deadline. */
  submissionDeadline: string;
  /** Deliverables the policy requires that the group has not handed in. */
  missingDeliverables: number;
}

/**
 * Turns an assignment the group is behind on into a notification, at read
 * time. Returns nothing once the work is in, once the deadline has passed, or
 * while it is still far off - so it appears exactly while it is actionable.
 */
export function dueSoonNotification(
  input: DueSoonInput,
  recipientUid: string,
  nowMs: number,
): AppNotification | null {
  if (input.missingDeliverables === 0) return null;

  const deadlineMs = Date.parse(input.submissionDeadline);
  if (Number.isNaN(deadlineMs)) return null;

  const hoursLeft = (deadlineMs - nowMs) / 3_600_000;
  if (hoursLeft <= 0 || hoursLeft > DUE_SOON_HOURS) return null;

  return {
    // Derived, so the id is stable rather than random: opening the list twice
    // must not look like two different warnings.
    id: `due__${input.assignmentId}__${recipientUid}`,
    recipientUid,
    kind: 'submission.dueSoon',
    params: {
      case: input.caseTitle,
      missing: input.missingDeliverables,
      hours: Math.max(1, Math.round(hoursLeft)),
    },
    href: `/classes/${input.classId}`,
    createdAt: new Date(nowMs).toISOString(),
  };
}

/** Newest first, with anything unread ahead of anything already seen. */
export function sortForReading(
  notifications: readonly AppNotification[],
): AppNotification[] {
  return [...notifications].sort((a, b) => {
    const unread = Number(Boolean(a.readAt)) - Number(Boolean(b.readAt));
    return unread !== 0 ? unread : b.createdAt.localeCompare(a.createdAt);
  });
}

/**
 * The i18n key of a kind.
 *
 * Kinds are written with a dot because that is how the rest of the system
 * names events, and audit log actions match them. A dot in a message key is a
 * namespace separator, so the catalogue holds a flat name instead and this
 * bridges the two.
 */
export function notificationKeyOf(kind: NotificationKind): string {
  return kind.replace(/\.(.)/g, (_match, letter: string) => letter.toUpperCase());
}

export function unreadCount(notifications: readonly AppNotification[]): number {
  return notifications.filter((notification) => !notification.readAt).length;
}

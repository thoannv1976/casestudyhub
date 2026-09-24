import type { Deliverable } from '../policy/presentation-policy';

/**
 * Where a group has got to (SRS Module 04).
 *
 * A lecturer running six groups does not want a list of assignments, they want
 * to know which three are behind. That question has one answer per assignment,
 * and it is worked out here rather than in each page that asks it - the class
 * page, the dashboard and any report would otherwise each draw their own line
 * between "late" and "overdue".
 */

export const PROGRESS_STATES = [
  /** Something is still missing and there is still time. */
  'awaiting',
  /** Something is still missing and the deadline has passed. */
  'overdue',
  /** Everything required is in; nobody has marked it yet. */
  'complete',
  /** The lecturer has drafted a mark but not published it. */
  'marked',
  /** The students can see their mark. */
  'published',
] as const;
export type ProgressState = (typeof PROGRESS_STATES)[number];

/**
 * The current version of each deliverable.
 *
 * Every submission is kept - a resubmission is a new version, never an
 * overwrite - so "what has this group handed in" always means the newest of
 * each. The rule lived in three places (the grading path, the class table and
 * the progress calculation) before it lived here.
 */
export function currentVersionsOf<T extends { deliverableId: string; versionNumber: number }>(
  submissions: readonly T[],
): T[] {
  const byDeliverable = new Map<string, T>();
  for (const submission of submissions) {
    const held = byDeliverable.get(submission.deliverableId);
    if (!held || submission.versionNumber > held.versionNumber) {
      byDeliverable.set(submission.deliverableId, submission);
    }
  }
  return [...byDeliverable.values()];
}

export interface AssignmentProgress {
  state: ProgressState;
  /** Required deliverables not handed in. */
  missing: number;
  /** Handed in, but after the deadline. */
  lateItems: number;
  /** True while a lecturer still has something to do about it. */
  needsLecturer: boolean;
}

export interface ProgressInput {
  requiredDeliverables: readonly Deliverable[];
  /** The current version of each deliverable handed in. */
  submitted: readonly { deliverableId: string; isLate: boolean }[];
  /** ISO timestamp. */
  submissionDeadline: string;
  nowMs: number;
  /** A lecturer has saved a draft assessment. */
  marked: boolean;
  /** Grades have been published to the group. */
  published: boolean;
}

/**
 * The states are ordered by what has already happened, not by what is missing:
 * a published mark stays published even if a deliverable was never handed in,
 * because the lecturer decided to mark it anyway and saying "overdue" would
 * contradict a decision already taken.
 */
export function assignmentProgress(input: ProgressInput): AssignmentProgress {
  const handedIn = new Set(input.submitted.map((item) => item.deliverableId));
  const missing = input.requiredDeliverables.filter(
    (deliverable) => deliverable.required && !handedIn.has(deliverable.id),
  ).length;
  const lateItems = input.submitted.filter((item) => item.isLate).length;

  if (input.published) {
    return { state: 'published', missing, lateItems, needsLecturer: false };
  }
  if (input.marked) {
    return { state: 'marked', missing, lateItems, needsLecturer: true };
  }
  if (missing > 0) {
    const deadlineMs = Date.parse(input.submissionDeadline);
    const overdue = !Number.isNaN(deadlineMs) && input.nowMs > deadlineMs;
    return {
      state: overdue ? 'overdue' : 'awaiting',
      missing,
      lateItems,
      // Chasing a group that is merely not finished yet is not the lecturer's
      // job until the deadline has gone.
      needsLecturer: overdue,
    };
  }
  return { state: 'complete', missing: 0, lateItems, needsLecturer: true };
}

/** The states a filter offers, in the order a lecturer works through them. */
export const PROGRESS_FILTERS = ['all', 'needsLecturer', ...PROGRESS_STATES] as const;
export type ProgressFilter = (typeof PROGRESS_FILTERS)[number];

export function matchesFilter(progress: AssignmentProgress, filter: ProgressFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'needsLecturer') return progress.needsLecturer;
  return progress.state === filter;
}

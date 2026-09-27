import { z } from 'zod';

/**
 * The class group project.
 *
 * A separate piece of work from the case study presentations, and deliberately
 * a separate thing in the data: every group in the class hands in the same
 * project once, in the final week, while case study assignments come and go
 * through the term with a case, a presentation date and a room attached. One
 * project per class, one deadline for everybody.
 *
 * It carries no presentation date. The pitch happens in the last session and
 * is run like any other; what this models is only what has to be handed in and
 * by when.
 */

export const CLASS_PROJECT_DELIVERABLE_IDS = [
  'project-pitch-deck',
  'project-report',
  'project-video',
] as const;

export const classProjectSchema = z.object({
  /** One per class, so the class id *is* the project id. */
  classId: z.string().min(1),
  /** ISO timestamp. The final week of the course, in practice. */
  deadline: z.string().min(1),
  /** The framework version the project froze, as an assignment does. */
  policyId: z.string().min(1),
  policyVersion: z.string().min(1),
  /**
   * How many groups may present the project, across however many sessions the
   * lecturer runs. Zero means nobody has been invited to volunteer yet, which
   * is where every class starts.
   */
  presentationSlots: z.number().int().min(0).max(20).default(0),
  /** Volunteering closes here, if the lecturer set a date. */
  volunteerDeadline: z.string().optional(),
});
export type ClassProject = z.infer<typeof classProjectSchema>;

/**
 * What a group hands work in against.
 *
 * There is no stored row per group. The id carries the class and the group, so
 * every submission query that already works for an assignment works here
 * unchanged, and the deadline stays in one place instead of being copied into
 * twenty rows that could drift apart.
 */
export function projectTargetId(classId: string, groupId: string): string {
  return `${classId}__${groupId}__project`;
}

export function parseProjectTargetId(id: string): { classId: string; groupId: string } | null {
  const parts = id.split('__');
  if (parts.length !== 3 || parts[2] !== 'project') return null;
  const [classId, groupId] = parts;
  if (!classId || !groupId) return null;
  return { classId, groupId };
}

/**
 * A group that has volunteered to present the project.
 *
 * The document id is `${classId}__${groupId}`, which is the rule rather than a
 * detail: a group cannot volunteer twice, including when two of its members
 * press the button in the same instant. How many volunteers fit is a separate
 * question, and one a read-then-write cannot answer honestly - it is settled
 * inside a transaction.
 */
export const projectVolunteerSchema = z.object({
  id: z.string().min(1),
  classId: z.string().min(1),
  groupId: z.string().min(1),
  /** Who pressed it, so the lecturer can ask them. */
  volunteeredByUid: z.string().min(1),
  volunteeredAt: z.string().min(1),
  /** First volunteer is 1. What a lecturer reads as "presents first". */
  slot: z.number().int().positive(),
});
export type ProjectVolunteer = z.infer<typeof projectVolunteerSchema>;

export function projectVolunteerId(classId: string, groupId: string): string {
  return `${classId}__${groupId}`;
}

/**
 * Whether volunteering is open, and why not when it is closed.
 *
 * Decided from the server's clock and the server's count, so every student in
 * the class sees the same answer whatever their device says.
 */
export function volunteeringWindow(
  project: Pick<ClassProject, 'presentationSlots' | 'volunteerDeadline'>,
  takenSlots: number,
  nowMs: number,
): { open: boolean; closedBecause: 'notOpened' | 'full' | 'deadline' | null } {
  if (project.presentationSlots <= 0) return { open: false, closedBecause: 'notOpened' };
  if (takenSlots >= project.presentationSlots) return { open: false, closedBecause: 'full' };

  if (project.volunteerDeadline) {
    const deadlineMs = Date.parse(project.volunteerDeadline);
    if (!Number.isNaN(deadlineMs) && nowMs > deadlineMs) {
      return { open: false, closedBecause: 'deadline' };
    }
  }

  return { open: true, closedBecause: null };
}

/**
 * Who in the class still owes a question, for one presentation.
 *
 * The presenting group is left out on purpose: they answer questions, they do
 * not ask them, and counting them as silent would make the tally a lie the
 * lecturer reads out loud.
 */
export interface AskerTally {
  expected: number;
  asked: number;
  missing: number;
  askedUids: string[];
  missingUids: string[];
}

export function askerTally(input: {
  /** Everyone active on the class roster. */
  classUids: readonly string[];
  /** Members of the group presenting. */
  presenterUids: readonly string[];
  /** Who has a question recorded for this session. */
  askerUids: readonly string[];
}): AskerTally {
  const presenters = new Set(input.presenterUids);
  const expected = [...new Set(input.classUids)].filter((uid) => !presenters.has(uid));
  const asked = new Set(input.askerUids);

  const askedUids = expected.filter((uid) => asked.has(uid));
  const missingUids = expected.filter((uid) => !asked.has(uid));

  return {
    expected: expected.length,
    asked: askedUids.length,
    missing: missingUids.length,
    askedUids,
    missingUids,
  };
}

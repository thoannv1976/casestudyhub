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

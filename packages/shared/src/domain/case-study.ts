import { z } from 'zod';
import { localeSchema } from './identity';

export const CASE_FILE_KINDS = ['case', 'guide', 'slide_template', 'reference', 'video'] as const;
export const caseFileKindSchema = z.enum(CASE_FILE_KINDS);
export type CaseFileKind = z.infer<typeof caseFileKindSchema>;

export const caseAttachmentSchema = z.object({
  id: z.string().min(1),
  kind: caseFileKindSchema,
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  storagePath: z.string().min(1),
  externalUrl: z.url().optional(),
});
export type CaseAttachment = z.infer<typeof caseAttachmentSchema>;

/**
 * A Case Study Template is the source material; a Case Assignment is one
 * hand-out of it to a class or group (SRS 5.2). Templates are reusable across
 * classes and semesters without re-uploading.
 */
export const caseStudySchema = z.object({
  id: z.string().min(1),
  caseCode: z.string().trim().min(1).max(32),
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().max(300).optional(),
  company: z.string().max(160).optional(),
  industry: z.string().max(160).optional(),
  courseId: z.string().min(1),
  chapter: z.string().max(160).optional(),
  description: z.string().max(4000).optional(),
  language: localeSchema,
  learningObjectives: z.array(z.string().min(1)).default([]),
  cloIds: z.array(z.string().min(1)).default([]),
  mainQuestions: z.array(z.string().min(1)).default([]),
  supportingQuestions: z.array(z.string().min(1)).default([]),
  references: z.array(z.string().min(1)).default([]),
  attachments: z.array(caseAttachmentSchema).default([]),
  currentVersionId: z.string().min(1).optional(),
  status: z.enum(['draft', 'published', 'archived']),
});
export type CaseStudy = z.infer<typeof caseStudySchema>;

export const ASSIGNMENT_STATUSES = [
  'assigned',
  'submission_open',
  'ready',
  'live',
  'under_review',
  'completed',
] as const;
export const assignmentStatusSchema = z.enum(ASSIGNMENT_STATUSES);
export type AssignmentStatus = z.infer<typeof assignmentStatusSchema>;

export const assignmentSchema = z.object({
  id: z.string().min(1),
  classId: z.string().min(1),
  groupId: z.string().min(1),
  caseStudyId: z.string().min(1),
  caseVersionId: z.string().min(1),
  /** Policy and rubric versions frozen at assignment time. */
  policyId: z.string().min(1),
  policyVersion: z.string().min(1),
  rubricVersion: z.string().min(1),
  /** ISO timestamps written from the server clock, never from the client. */
  presentationDate: z.string().min(1),
  submissionDeadline: z.string().min(1),
  status: assignmentStatusSchema,
});
export type Assignment = z.infer<typeof assignmentSchema>;

export const submissionSchema = z.object({
  id: z.string().min(1),
  assignmentId: z.string().min(1),
  groupId: z.string().min(1),
  deliverableId: z.string().min(1),
  submittedByUid: z.string().min(1),
  submittedAt: z.string().min(1),
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  storagePath: z.string().min(1),
  externalUrl: z.url().optional(),
  /** Versions accumulate; an upload never overwrites an earlier one. */
  versionNumber: z.number().int().positive(),
  isLate: z.boolean(),
  status: z.enum(['uploaded', 'processing', 'ready', 'failed', 'superseded']),
});
export type Submission = z.infer<typeof submissionSchema>;

export const gradeSchema = z.object({
  id: z.string().min(1),
  assignmentId: z.string().min(1),
  groupId: z.string().min(1),
  studentUid: z.string().min(1),
  groupScore: z.number().min(0),
  individualScore: z.number().min(0),
  finalScore: z.number().min(0),
  policyId: z.string().min(1),
  policyVersion: z.string().min(1),
  /** Only a lecturer may move a grade to `published` (SRS 13). */
  status: z.enum(['draft', 'published']),
  publishedAt: z.string().optional(),
  publishedByUid: z.string().optional(),
});
export type Grade = z.infer<typeof gradeSchema>;

/**
 * A presentation session (SRS Module 08, 10).
 *
 * The timer stores server timestamps and accumulated milliseconds rather than a
 * ticking value: a number that has to be written every second would cost a
 * write per second per class, and would still drift between devices.
 */
export const SESSION_STATUSES = ['scheduled', 'live', 'qa', 'review', 'completed'] as const;
export const sessionStatusSchema = z.enum(SESSION_STATUSES);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const presentationSessionSchema = z.object({
  id: z.string().min(1),
  classId: z.string().min(1),
  assignmentId: z.string().min(1),
  groupId: z.string().min(1),
  caseStudyId: z.string().min(1),
  status: sessionStatusSchema,
  /** Which of the six roles is speaking now, if any. */
  currentRoleId: z.string().nullable().default(null),
  /** Set while the clock runs; null while paused. */
  runningSinceMs: z.number().nullable().default(null),
  /** Time already counted, excluding any currently running stretch. */
  accumulatedMs: z.number().nonnegative().default(0),
  /** Time per role, so a member carrying two roles is still measured fairly. */
  roleMs: z.record(z.string(), z.number()).default({}),
  /** The class may ask questions while this is open. */
  questionsOpen: z.boolean().default(false),
  /** The class may score the group while this is open. */
  peerReviewOpen: z.boolean().default(false),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
});
export type PresentationSession = z.infer<typeof presentationSessionSchema>;

/** Elapsed time of a session, including the stretch running right now. */
export function elapsedMs(session: PresentationSession, nowMs: number): number {
  const running = session.runningSinceMs === null ? 0 : Math.max(0, nowMs - session.runningSinceMs);
  return session.accumulatedMs + running;
}

/** Elapsed time attributed to one role, including the running stretch. */
export function roleElapsedMs(session: PresentationSession, roleId: string, nowMs: number): number {
  const stored = session.roleMs[roleId] ?? 0;
  if (session.currentRoleId !== roleId || session.runningSinceMs === null) return stored;
  return stored + Math.max(0, nowMs - session.runningSinceMs);
}

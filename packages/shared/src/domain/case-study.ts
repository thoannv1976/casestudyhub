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

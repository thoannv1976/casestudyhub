import { z } from 'zod';

/**
 * The lecturer's own marking (SRS Module 13).
 *
 * Everything the class produced during the presentation - the clock, the Q&A
 * checklist, the peer scores - arrives at this screen as evidence. None of it
 * becomes a mark by itself. The lecturer awards the rubric points and the
 * individual scores, and only then does the grade engine run, on the policy
 * version frozen into the assignment.
 */

export const individualAssessmentSchema = z.object({
  /** Role performance and Q&A quality, on the policy's scale. */
  rawScore: z.number({ error: 'errors.individualScoreRequired' }).min(0).max(100),
  /** Forfeits the individual share under the Guide's thresholds. */
  didNotPresent: z.boolean().default(false),
  failedOwnRoleQuestion: z.boolean().default(false),
  note: z.string().trim().max(1000).optional(),
});
export type IndividualAssessment = z.infer<typeof individualAssessmentSchema>;

export const lecturerAssessmentSchema = z.object({
  /** One per assignment: the mark for one group's presentation of one case. */
  id: z.string().min(1),
  assignmentId: z.string().min(1),
  classId: z.string().min(1),
  groupId: z.string().min(1),
  caseStudyId: z.string().min(1),
  /** Rubric points awarded to the group, keyed by criterion id. */
  criterionScores: z.record(z.string(), z.number().nonnegative()),
  groupScoreRaw: z.number().nonnegative(),
  comment: z.string().max(4000).optional(),
  /** The late penalty may be waived, but never silently. */
  latePenaltyWaived: z.boolean().default(false),
  latePenaltyWaiverReason: z.string().max(1000).optional(),
  individual: z.record(z.string(), individualAssessmentSchema),
  rubricId: z.string().min(1),
  rubricVersion: z.string().min(1),
  policyId: z.string().min(1),
  policyVersion: z.string().min(1),
  status: z.enum(['draft', 'published']),
  assessedByUid: z.string().min(1),
  assessedByName: z.string().min(1),
  updatedAt: z.string().min(1),
  publishedAt: z.string().optional(),
});
export type LecturerAssessment = z.infer<typeof lecturerAssessmentSchema>;

export const saveLecturerAssessmentSchema = z
  .object({
    criterionScores: z.record(
      z.string(),
      z.number({ error: 'errors.criterionScoreRequired' }).nonnegative(),
    ),
    comment: z.string().trim().max(4000).optional(),
    latePenaltyWaived: z.boolean().default(false),
    latePenaltyWaiverReason: z.string().trim().max(1000).optional(),
    individual: z.record(z.string(), individualAssessmentSchema),
  })
  .refine(
    (input) => !input.latePenaltyWaived || (input.latePenaltyWaiverReason ?? '').length >= 10,
    { error: 'errors.waiverNeedsReason', path: ['latePenaltyWaiverReason'] },
  );
export type SaveLecturerAssessmentRequest = z.infer<typeof saveLecturerAssessmentSchema>;

export const addClassLecturerSchema = z.object({
  email: z.email({ error: 'errors.emailInvalid' }),
});

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

/** Which piece of work a mark belongs to. */
export const gradedWorkKindSchema = z.enum(['case_study', 'group_project']);
export type GradedWorkKind = z.infer<typeof gradedWorkKindSchema>;

/**
 * The two parts of the class group project that are earned outside the rubric
 * (Guide, section 7). Recorded as facts - the team shipped an MVP, the team
 * made a video - rather than as points, so what they are worth stays in the
 * framework where a faculty can change it.
 */
export const projectBonusAwardSchema = z.object({
  mvp: z.boolean().default(false),
  video: z.boolean().default(false),
});
export type ProjectBonusAward = z.infer<typeof projectBonusAwardSchema>;

export const lecturerAssessmentSchema = z.object({
  /** One per piece of work: a group's case study, or its class project. */
  id: z.string().min(1),
  assignmentId: z.string().min(1),
  classId: z.string().min(1),
  groupId: z.string().min(1),
  kind: gradedWorkKindSchema.default('case_study'),
  /** A case study is marked against a case; the class project is not. */
  caseStudyId: z.string().min(1).optional(),
  /** Only ever set on a class project. */
  bonus: projectBonusAwardSchema.default({ mvp: false, video: false }),
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
    bonus: projectBonusAwardSchema.optional(),
  })
  .refine(
    (input) => !input.latePenaltyWaived || (input.latePenaltyWaiverReason ?? '').length >= 10,
    { error: 'errors.waiverNeedsReason', path: ['latePenaltyWaiverReason'] },
  );
export type SaveLecturerAssessmentRequest = z.infer<typeof saveLecturerAssessmentSchema>;

export const addClassLecturerSchema = z.object({
  email: z.email({ error: 'errors.emailInvalid' }),
});

import { z } from 'zod';
import {
  DEFAULT_PRESENTATION_ROLES,
  presentationRoleIdSchema,
  presentationRoleSchema,
} from '../domain/roles';
import { DEFAULT_RUBRIC, rubricSchema } from '../domain/rubric';

/**
 * Academic Assessment Policy (SRS 13.2).
 *
 * Every academic rule of the Presentation Guide lives here as data, never as a
 * hard-coded constant inside a feature. A policy is immutable once used for a
 * published grade: changing a rule creates a new `version`, so grades already
 * published keep the rules they were computed with.
 */

export const deliverableFormatSchema = z.enum(['PDF', 'PPTX', 'DOCX', 'IMAGE', 'LINK', 'FORM']);
export type DeliverableFormat = z.infer<typeof deliverableFormatSchema>;

export const deliverableSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  formats: z.array(deliverableFormatSchema).min(1),
  required: z.boolean(),
  /** Zero for a deliverable that is a link: there is no file to size. */
  maxFileSizeMb: z.number().nonnegative(),
});
export type Deliverable = z.infer<typeof deliverableSchema>;

export const slideSkeletonEntrySchema = z.object({
  slide: z.number().int().positive(),
  key: z.string().min(1),
  roleId: presentationRoleIdSchema.nullable(),
});
export type SlideSkeletonEntry = z.infer<typeof slideSkeletonEntrySchema>;

/**
 * A course learning outcome, as the faculty writes it.
 *
 * The name is stored as text, not as a message key - unlike every other string
 * in this system. A CLO is the faculty's own wording from their syllabus, the
 * same kind of content as a class name or a case title, not interface text
 * this project translates. Writing it as a key would mean no faculty could add
 * one without a developer, which is exactly what this whole module exists to
 * avoid.
 */
export const courseOutcomeSchema = z.object({
  id: z.string().trim().min(1).max(16),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
});
export type CourseOutcome = z.infer<typeof courseOutcomeSchema>;

export const presentationPolicySchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    nameKey: z.string().min(1),
    /** Locked policies may not be edited; a change must create a new version. */
    locked: z.boolean().default(false),

    groupSize: z
      .object({ min: z.number().int().positive(), max: z.number().int().positive() })
      .refine((v) => v.min <= v.max, { message: 'groupSize.min must not exceed groupSize.max' }),

    presentation: z.object({
      minMinutes: z.number().positive(),
      maxMinutes: z.number().positive(),
      /** Presentations running beyond this are stopped (Guide, thresholds). */
      hardStopMinutes: z.number().positive(),
    }),

    qa: z.object({
      minMinutes: z.number().positive(),
      maxMinutes: z.number().positive(),
      minClassQuestions: z.number().int().nonnegative(),
      minPairedGroupChallenges: z.number().int().nonnegative(),
      everyMemberMustAnswer: z.boolean(),
    }),

    slides: z.object({
      min: z.number().int().positive(),
      max: z.number().int().positive(),
      excludeCoverAndSources: z.boolean(),
    }),

    submission: z.object({
      deadlineHoursBeforeSession: z.number().nonnegative(),
      allowResubmission: z.boolean(),
      keepAllVersions: z.literal(true),
    }),

    grading: z.object({
      maxScore: z.number().positive(),
      teamWeight: z.number().min(0).max(1),
      individualWeight: z.number().min(0).max(1),
      /** Points deducted from the 100-point scale for a late submission. */
      lateSubmissionPenaltyPoints: z.number().nonnegative(),
      /** Decimal places kept in a published score. */
      decimals: z.number().int().min(0).max(3),
      /** A student who does not present forfeits the whole individual share. */
      forfeitIndividualIfAbsent: z.boolean(),
      /** ... likewise if they cannot answer a question owned by their role. */
      forfeitIndividualIfUnansweredOwnRole: z.boolean(),
      /** Peer assessment is feedback by default, never an automatic grade. */
      peerAssessmentWeight: z.number().min(0).max(1),
      /** AI scores are drafts; only a lecturer may publish a grade. */
      aiScoreIsAdvisoryOnly: z.literal(true),
    }),

    /**
     * What the faculty calls each outcome the rubric claims to measure. The
     * mapping itself lives on each rubric criterion, so it is frozen with the
     * framework and a report from March stays reproducible in June.
     */
    clos: z.array(courseOutcomeSchema).default([]),

    /**
     * The share of an outcome's points a piece of work must reach to count as
     * having met it. A faculty decision, which is why it is stored rather than
     * defaulted somewhere in the reporting code.
     */
    cloThreshold: z.number().min(0).max(1).default(0.5),

    /**
     * True once the faculty has checked the criterion-to-outcome mapping
     * against the syllabus. Until then every report says so on its face: a
     * number nobody has confirmed should not be quoted as if it were.
     */
    cloMappingConfirmed: z.boolean().default(false),

    roles: z.array(presentationRoleSchema).min(1),
    rubric: rubricSchema,
    slideSkeleton: z.array(slideSkeletonEntrySchema),
    deliverables: z.array(deliverableSchema),
  })
  .refine((p) => Math.abs(p.grading.teamWeight + p.grading.individualWeight - 1) < 1e-9, {
    message: 'teamWeight + individualWeight must equal 1',
    path: ['grading'],
  })
  .refine((p) => p.presentation.hardStopMinutes >= p.presentation.maxMinutes, {
    message: 'hardStopMinutes must not be smaller than maxMinutes',
    path: ['presentation', 'hardStopMinutes'],
  })
  .refine((p) => p.slides.min <= p.slides.max, {
    message: 'slides.min must not exceed slides.max',
    path: ['slides'],
  });

export type PresentationPolicy = z.infer<typeof presentationPolicySchema>;

/**
 * "E-Commerce 2026 - Standard Case Study Presentation Framework" (SRS Module 06).
 * Values come from the Case Study Presentation Guide, section 1 (Format overview),
 * section 6 (Marking rubric) and its attainment thresholds. Lecturers may clone
 * this policy and change any value for another course.
 */
export const DEFAULT_PRESENTATION_POLICY: PresentationPolicy = {
  id: 'ecom-2026-standard',
  version: '2026.1',
  nameKey: 'policy.ecom2026Standard',
  locked: false,
  groupSize: { min: 4, max: 6 },
  presentation: { minMinutes: 18, maxMinutes: 20, hardStopMinutes: 22 },

  /**
   * The outcomes the shipped rubric claims to measure, named as the Guide
   * names them. `cloMappingConfirmed` stays false until a faculty has checked
   * this against their own syllabus - which is a different document from the
   * Guide this default came from.
   */
  clos: [
    { id: 'CLO1', name: 'Analyse a business case and identify the decision at stake' },
    { id: 'CLO2', name: 'Support an argument with evidence and figures' },
    { id: 'CLO4', name: 'Communicate a recommendation to a business audience' },
    { id: 'CLO6', name: 'Evaluate alternatives and justify a choice' },
  ],
  cloThreshold: 0.5,
  cloMappingConfirmed: false,
  qa: {
    minMinutes: 8,
    maxMinutes: 10,
    minClassQuestions: 2,
    minPairedGroupChallenges: 1,
    everyMemberMustAnswer: true,
  },
  slides: { min: 14, max: 18, excludeCoverAndSources: true },
  submission: {
    deadlineHoursBeforeSession: 24,
    allowResubmission: true,
    keepAllVersions: true,
  },
  grading: {
    maxScore: 100,
    teamWeight: 0.8,
    individualWeight: 0.2,
    lateSubmissionPenaltyPoints: 10,
    decimals: 0,
    forfeitIndividualIfAbsent: true,
    forfeitIndividualIfUnansweredOwnRole: true,
    peerAssessmentWeight: 0,
    aiScoreIsAdvisoryOnly: true,
  },
  roles: [...DEFAULT_PRESENTATION_ROLES],
  rubric: DEFAULT_RUBRIC,
  slideSkeleton: [
    { slide: 1, key: 'slides.cover', roleId: null },
    { slide: 2, key: 'slides.centralProblem', roleId: 'R1' },
    { slide: 3, key: 'slides.companyContext', roleId: 'R1' },
    { slide: 4, key: 'slides.chapterLink', roleId: 'R1' },
    { slide: 5, key: 'slides.businessModel', roleId: 'R2' },
    { slide: 6, key: 'slides.operatingMechanism', roleId: 'R2' },
    { slide: 7, key: 'slides.competitiveAdvantage', roleId: 'R2' },
    { slide: 8, key: 'slides.keyIndicators', roleId: 'R3' },
    { slide: 9, key: 'slides.calculation', roleId: 'R3' },
    { slide: 10, key: 'slides.numbersLimits', roleId: 'R3' },
    { slide: 11, key: 'slides.risks', roleId: 'R4' },
    { slide: 12, key: 'slides.weakestAssumption', roleId: 'R4' },
    { slide: 13, key: 'slides.transferConditions', roleId: 'R5' },
    { slide: 14, key: 'slides.appliesOrNot', roleId: 'R5' },
    { slide: 15, key: 'slides.threeLessons', roleId: 'R6' },
    { slide: 16, key: 'slides.managementDecision', roleId: 'R6' },
  ],
  deliverables: [
    {
      id: 'slides-pdf',
      key: 'deliverables.slidesPdf',
      formats: ['PDF'],
      required: true,
      maxFileSizeMb: 50,
    },
    {
      id: 'slides-source',
      key: 'deliverables.slidesSource',
      formats: ['PPTX', 'LINK'],
      required: true,
      maxFileSizeMb: 100,
    },
    {
      id: 'role-allocation-sheet',
      key: 'deliverables.roleAllocationSheet',
      formats: ['PDF', 'IMAGE'],
      required: true,
      maxFileSizeMb: 10,
    },
    {
      id: 'reference-list',
      key: 'deliverables.referenceList',
      formats: ['PDF', 'DOCX', 'LINK'],
      required: true,
      maxFileSizeMb: 10,
    },
    {
      id: 'ai-usage-disclosure',
      key: 'deliverables.aiUsageDisclosure',
      formats: ['PDF', 'DOCX', 'FORM'],
      required: true,
      maxFileSizeMb: 10,
    },
    {
      // Recorded on a phone and put on YouTube. Asking a group to push a
      // gigabyte through this platform as well would be asking them to do the
      // same work twice, so this one is satisfied by a link.
      id: 'presentation-video',
      key: 'deliverables.presentationVideo',
      formats: ['LINK'],
      required: false,
      maxFileSizeMb: 0,
    },
    {
      id: 'case-analysis-report',
      key: 'deliverables.caseAnalysisReport',
      formats: ['PDF', 'DOCX'],
      required: false,
      maxFileSizeMb: 50,
    },
  ],
};

/** Validates a policy and returns it typed, throwing on any broken academic rule. */
export function parsePresentationPolicy(input: unknown): PresentationPolicy {
  return presentationPolicySchema.parse(input);
}

/**
 * What a request to publish a new version carries.
 *
 * The whole framework, not a patch: the schema's own refinements - weights
 * summing to one, a hard stop no earlier than the maximum - only hold when
 * they are checked against the complete object.
 */
export const savePolicySchema = z.object({
  policy: presentationPolicySchema,
  reason: z.string().trim().min(10, 'errors.policyReasonTooShort').max(500),
});
export type SavePolicyRequest = z.infer<typeof savePolicySchema>;

/**
 * The next version number after `current`, when it ends in a number. A faculty
 * numbering versions 2026.1, 2026.2 should not have to count.
 */
export function nextVersionAfter(current: string): string {
  const match = /^(.*?)(\d+)$/.exec(current);
  if (!match) return `${current}.1`;
  return `${match[1]}${Number(match[2]) + 1}`;
}

import { z } from 'zod';
import { aiAssessableMaxPoints, type Rubric } from './rubric';

/**
 * AI assessment (SRS Module 12).
 *
 * Three rules hold everywhere in this file and are enforced, not merely
 * intended:
 *
 * 1. The AI proposes; the lecturer decides. A suggestion is never written to a
 *    grade, and `aiScoreIsAdvisoryOnly` in the policy says so.
 * 2. Every judgement carries a citation - a slide or a page, and the words
 *    that were read there. A score with nothing to point at is not evidence,
 *    and `withoutCitations` finds them.
 * 3. The AI never scores a criterion marked `aiAssessable: false`. Delivery in
 *    the room cannot be inferred from an uploaded file, so it is not offered.
 */

export const AI_SOURCES = ['slides', 'report', 'case'] as const;
export const aiSourceSchema = z.enum(AI_SOURCES);
export type AiSource = z.infer<typeof aiSourceSchema>;

export const aiCitationSchema = z.object({
  source: aiSourceSchema,
  /** Where in that document, in the document's own terms: "slide 9", "p. 4". */
  locator: z.string().trim().min(1).max(120),
  /** The words actually read there, so a lecturer can check the claim. */
  quote: z.string().trim().min(1).max(600),
});
export type AiCitation = z.infer<typeof aiCitationSchema>;

export const aiCriterionVerdictSchema = z.object({
  criterionId: z.string().min(1),
  suggestedPoints: z.number().nonnegative(),
  maxPoints: z.number().nonnegative(),
  reasoning: z.string().trim().min(1).max(2000),
  citations: z.array(aiCitationSchema).max(8).default([]),
  /** The model's own confidence, shown to the lecturer, never acted on. */
  confidence: z.enum(['low', 'medium', 'high']).default('medium'),
});
export type AiCriterionVerdict = z.infer<typeof aiCriterionVerdictSchema>;

export const aiAssessmentSchema = z.object({
  id: z.string().min(1),
  assignmentId: z.string().min(1),
  classId: z.string().min(1),
  groupId: z.string().min(1),
  caseStudyId: z.string().min(1),
  criteria: z.array(aiCriterionVerdictSchema),
  /** Out of the AI-assessable points only, never out of the full rubric. */
  suggestedTotal: z.number().nonnegative(),
  assessableMaxPoints: z.number().nonnegative(),
  /** What the model could not find, in its own words. */
  gaps: z.array(z.string().max(500)).max(20).default([]),
  rubricId: z.string().min(1),
  rubricVersion: z.string().min(1),
  model: z.string().min(1),
  promptTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  latencyMs: z.number().int().nonnegative().default(0),
  createdAt: z.string().min(1),
  requestedByUid: z.string().min(1),
});
export type AiAssessment = z.infer<typeof aiAssessmentSchema>;

/** The shape the model is asked to return, before any of our rules apply. */
export const aiEvaluationResponseSchema = z.object({
  criteria: z.array(
    z.object({
      criterionId: z.string(),
      suggestedPoints: z.number(),
      reasoning: z.string(),
      citations: z
        .array(
          z.object({
            source: z.string(),
            locator: z.string(),
            quote: z.string(),
          }),
        )
        .default([]),
      confidence: z.string().default('medium'),
    }),
  ),
  gaps: z.array(z.string()).default([]),
});

/** JSON Schema for the same shape, for the model's structured output mode. */
export const AI_EVALUATION_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          criterionId: { type: 'string' },
          suggestedPoints: { type: 'number' },
          reasoning: { type: 'string' },
          citations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                source: { type: 'string', enum: [...AI_SOURCES] },
                locator: { type: 'string' },
                quote: { type: 'string' },
              },
              required: ['source', 'locator', 'quote'],
            },
          },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['criterionId', 'suggestedPoints', 'reasoning', 'citations', 'confidence'],
      },
    },
    gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['criteria', 'gaps'],
};

/**
 * Brings a model's answer inside the rubric's own rules.
 *
 * A model asked for a score out of 25 will sometimes return 30, or score a
 * criterion nobody asked about, or score the one the lecturer must judge in
 * person. None of that reaches the lecturer's screen: unknown criteria are
 * dropped, lecturer-only criteria are dropped, and a score is clamped to the
 * points its criterion is actually worth.
 */
export function reconcileWithRubric(
  response: z.infer<typeof aiEvaluationResponseSchema>,
  rubric: Rubric,
): { criteria: AiCriterionVerdict[]; suggestedTotal: number; assessableMaxPoints: number } {
  const assessable = new Map(
    rubric.criteria.filter((criterion) => criterion.aiAssessable).map((c) => [c.id, c]),
  );

  const criteria: AiCriterionVerdict[] = [];
  for (const entry of response.criteria) {
    const criterion = assessable.get(entry.criterionId);
    if (!criterion) continue;
    if (criteria.some((existing) => existing.criterionId === criterion.id)) continue;

    const confidence =
      entry.confidence === 'low' || entry.confidence === 'high' ? entry.confidence : 'medium';

    criteria.push({
      criterionId: criterion.id,
      suggestedPoints: Math.min(Math.max(entry.suggestedPoints, 0), criterion.maxPoints),
      maxPoints: criterion.maxPoints,
      reasoning: entry.reasoning.slice(0, 2000),
      citations: entry.citations
        .filter((citation): citation is AiCitation => aiCitationSchema.safeParse(citation).success)
        .slice(0, 8),
      confidence,
    });
  }

  return {
    criteria,
    suggestedTotal: criteria.reduce((sum, entry) => sum + entry.suggestedPoints, 0),
    assessableMaxPoints: aiAssessableMaxPoints(rubric),
  };
}

/** Judgements the lecturer should distrust: a score with nothing to point at. */
export function withoutCitations(criteria: readonly AiCriterionVerdict[]): AiCriterionVerdict[] {
  return criteria.filter((criterion) => criterion.citations.length === 0);
}

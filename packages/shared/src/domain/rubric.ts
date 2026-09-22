import { z } from 'zod';

/**
 * Rubric criteria of the Case Study Presentation Guide (Table 5, 100 points).
 * `aiAssessable: false` marks the criterion the lecturer must judge in person -
 * AI may never infer live delivery quality from uploaded slides alone (SRS 12.3).
 */
export const rubricCriterionSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  maxPoints: z.number().min(0),
  aiAssessable: z.boolean(),
  cloIds: z.array(z.string().min(1)),
});
export type RubricCriterion = z.infer<typeof rubricCriterionSchema>;

export const rubricSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    nameKey: z.string().min(1),
    totalPoints: z.number().positive(),
    criteria: z.array(rubricCriterionSchema).min(1),
  })
  .refine(
    (rubric) =>
      Math.abs(rubric.criteria.reduce((sum, c) => sum + c.maxPoints, 0) - rubric.totalPoints) <
      1e-9,
    { message: 'Rubric criteria must add up to totalPoints', path: ['criteria'] },
  );
export type Rubric = z.infer<typeof rubricSchema>;

/**
 * CLO mapping below is the illustrative mapping of SRS 14.4. The lecturer must
 * confirm the official mapping against the course syllabus before it is used
 * for CLO attainment reporting.
 */
export const DEFAULT_RUBRIC: Rubric = {
  id: 'rubric-standard-100',
  version: '2026.1',
  nameKey: 'rubric.standard100',
  totalPoints: 100,
  criteria: [
    {
      id: 'understanding',
      key: 'rubric.criteria.understanding',
      maxPoints: 20,
      aiAssessable: true,
      cloIds: ['CLO1'],
    },
    {
      id: 'analysis',
      key: 'rubric.criteria.analysis',
      maxPoints: 25,
      aiAssessable: true,
      cloIds: ['CLO1', 'CLO2'],
    },
    {
      id: 'evidence',
      key: 'rubric.criteria.evidence',
      maxPoints: 15,
      aiAssessable: true,
      cloIds: ['CLO1', 'CLO2'],
    },
    {
      id: 'critique',
      key: 'rubric.criteria.critique',
      maxPoints: 15,
      aiAssessable: true,
      cloIds: ['CLO6'],
    },
    {
      id: 'transferDecision',
      key: 'rubric.criteria.transferDecision',
      maxPoints: 15,
      aiAssessable: true,
      cloIds: ['CLO2', 'CLO4', 'CLO6'],
    },
    {
      id: 'delivery',
      key: 'rubric.criteria.delivery',
      maxPoints: 10,
      aiAssessable: false,
      cloIds: [],
    },
  ],
};

/** Points AI may propose at most - the lecturer-only criteria are excluded. */
export function aiAssessableMaxPoints(rubric: Rubric): number {
  return rubric.criteria.filter((c) => c.aiAssessable).reduce((sum, c) => sum + c.maxPoints, 0);
}

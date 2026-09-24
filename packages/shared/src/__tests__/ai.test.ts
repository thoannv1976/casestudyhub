import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESENTATION_POLICY,
  aiAssessableMaxPoints,
  reconcileWithRubric,
  withoutCitations,
  type AiCriterionVerdict,
} from '../index';

const rubric = DEFAULT_PRESENTATION_POLICY.rubric;

function modelSaid(criteria: Record<string, unknown>[], gaps: string[] = []) {
  return { criteria, gaps } as Parameters<typeof reconcileWithRubric>[0];
}

const citation = [{ source: 'slides', locator: 'slide 9', quote: 'Third-party seller services' }];

describe('bringing a model answer inside the rubric', () => {
  it('never lets the AI score the criterion judged in the room', () => {
    // `delivery` is aiAssessable: false. A model asked about it anyway is
    // simply not listened to.
    const result = reconcileWithRubric(
      modelSaid([
        {
          criterionId: 'delivery',
          suggestedPoints: 10,
          reasoning: 'They seemed confident.',
          citations: [],
          confidence: 'high',
        },
        {
          criterionId: 'analysis',
          suggestedPoints: 20,
          reasoning: 'Solid.',
          citations: citation,
          confidence: 'medium',
        },
      ]),
      rubric,
    );

    expect(result.criteria.map((c) => c.criterionId)).toEqual(['analysis']);
  });

  it('clamps a score above what the criterion is worth', () => {
    const result = reconcileWithRubric(
      modelSaid([
        {
          criterionId: 'evidence',
          suggestedPoints: 40,
          reasoning: 'Excellent.',
          citations: citation,
          confidence: 'high',
        },
      ]),
      rubric,
    );

    expect(result.criteria[0]?.suggestedPoints).toBe(15);
    expect(result.criteria[0]?.maxPoints).toBe(15);
  });

  it('clamps a negative score to zero', () => {
    const result = reconcileWithRubric(
      modelSaid([
        {
          criterionId: 'evidence',
          suggestedPoints: -5,
          reasoning: 'Nothing there.',
          citations: citation,
          confidence: 'low',
        },
      ]),
      rubric,
    );
    expect(result.criteria[0]?.suggestedPoints).toBe(0);
  });

  it('drops a criterion that does not exist in this rubric', () => {
    const result = reconcileWithRubric(
      modelSaid([
        {
          criterionId: 'charisma',
          suggestedPoints: 10,
          reasoning: 'Charming.',
          citations: citation,
          confidence: 'high',
        },
      ]),
      rubric,
    );
    expect(result.criteria).toEqual([]);
    expect(result.suggestedTotal).toBe(0);
  });

  it('keeps the first answer when a model scores the same criterion twice', () => {
    const result = reconcileWithRubric(
      modelSaid([
        {
          criterionId: 'analysis',
          suggestedPoints: 20,
          reasoning: 'First.',
          citations: citation,
          confidence: 'medium',
        },
        {
          criterionId: 'analysis',
          suggestedPoints: 5,
          reasoning: 'Second.',
          citations: citation,
          confidence: 'low',
        },
      ]),
      rubric,
    );
    expect(result.criteria).toHaveLength(1);
    expect(result.criteria[0]?.reasoning).toBe('First.');
  });

  it('drops a citation that is not a citation, and keeps the ones that are', () => {
    const result = reconcileWithRubric(
      modelSaid([
        {
          criterionId: 'analysis',
          suggestedPoints: 20,
          reasoning: 'Solid.',
          citations: [
            { source: 'slides', locator: 'slide 9', quote: 'Third-party seller services' },
            { source: 'somewhere', locator: '', quote: '' },
          ],
          confidence: 'medium',
        },
      ]),
      rubric,
    );
    expect(result.criteria[0]?.citations).toHaveLength(1);
    expect(result.criteria[0]?.citations[0]?.locator).toBe('slide 9');
  });

  it('falls back to medium for a confidence the model made up', () => {
    const result = reconcileWithRubric(
      modelSaid([
        {
          criterionId: 'analysis',
          suggestedPoints: 20,
          reasoning: 'Solid.',
          citations: citation,
          confidence: 'absolute',
        },
      ]),
      rubric,
    );
    expect(result.criteria[0]?.confidence).toBe('medium');
  });

  it('totals out of the assessable points, not the whole rubric', () => {
    const everything = rubric.criteria.map((criterion) => ({
      criterionId: criterion.id,
      suggestedPoints: criterion.maxPoints,
      reasoning: 'Full marks.',
      citations: citation,
      confidence: 'high',
    }));

    const result = reconcileWithRubric(modelSaid(everything), rubric);

    // 100 points in the rubric, 90 of which the AI may speak to.
    expect(result.assessableMaxPoints).toBe(aiAssessableMaxPoints(rubric));
    expect(result.assessableMaxPoints).toBe(90);
    expect(result.suggestedTotal).toBe(90);
  });
});

describe('a suggestion with nothing to point at', () => {
  it('is found, so the lecturer can distrust it on sight', () => {
    const criteria: AiCriterionVerdict[] = [
      {
        criterionId: 'analysis',
        suggestedPoints: 20,
        maxPoints: 25,
        reasoning: 'Solid.',
        citations: [],
        confidence: 'high',
      },
      {
        criterionId: 'evidence',
        suggestedPoints: 12,
        maxPoints: 15,
        reasoning: 'Figures shown.',
        citations: [{ source: 'slides', locator: 'slide 9', quote: 'Revenue mix' }],
        confidence: 'medium',
      },
    ];

    expect(withoutCitations(criteria).map((c) => c.criterionId)).toEqual(['analysis']);
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESENTATION_POLICY,
  summarisePeerReviews,
  validatePeerScores,
  type PeerReview,
} from '../index';

const rubric = DEFAULT_PRESENTATION_POLICY.rubric;

/** A full, valid set of scores: every criterion at its maximum. */
const perfect = Object.fromEntries(
  rubric.criteria.map((criterion) => [criterion.id, criterion.maxPoints]),
);

function review(scores: Record<string, number>, overrides: Partial<PeerReview> = {}): PeerReview {
  const total = Object.values(scores).reduce((sum, value) => sum + value, 0);
  return {
    id: 'PS1__uid',
    sessionId: 'PS1',
    classId: 'C1',
    caseStudyId: 'CS1',
    groupId: 'G1',
    reviewerUid: 'uid',
    reviewerName: 'Reviewer',
    reviewerStudentId: 'SV001',
    reviewerGroupId: 'G2',
    scores,
    total,
    rubricId: rubric.id,
    rubricVersion: rubric.version,
    submittedAt: '2026-10-01T02:00:00.000Z',
    ...overrides,
  };
}

describe('scoring against the rubric the class was given', () => {
  it('accepts a full set and totals it', () => {
    const result = validatePeerScores(perfect, rubric);
    expect(result).toEqual({ ok: true, total: rubric.totalPoints });
  });

  it('refuses a score above what the criterion is worth', () => {
    const result = validatePeerScores({ ...perfect, delivery: 30 }, rubric);
    expect(result).toEqual({
      ok: false,
      messageKey: 'errors.peerScoreOutOfRange',
      criterionId: 'delivery',
    });
  });

  it('refuses a partly filled form, naming the criterion still empty', () => {
    const { critique: _omitted, ...rest } = perfect;
    const result = validatePeerScores(rest, rubric);
    expect(result).toEqual({
      ok: false,
      messageKey: 'errors.peerScoreRequired',
      criterionId: 'critique',
    });
  });

  it('refuses a criterion that is not in this rubric', () => {
    const result = validatePeerScores({ ...perfect, charisma: 10 }, rubric);
    expect(result).toEqual({ ok: false, messageKey: 'errors.peerScoreUnknownCriterion' });
  });

  it('accepts zero, which is a judgement and not a missing answer', () => {
    const zeros = Object.fromEntries(rubric.criteria.map((criterion) => [criterion.id, 0]));
    expect(validatePeerScores(zeros, rubric)).toEqual({ ok: true, total: 0 });
  });
});

describe('what the lecturer reads', () => {
  it('reports nothing rather than zero when nobody has scored', () => {
    const summary = summarisePeerReviews([], rubric);
    expect(summary.count).toBe(0);
    expect(summary.mean).toBe(0);
  });

  it('shows the mean and the median side by side', () => {
    const middling = Object.fromEntries(
      rubric.criteria.map((criterion) => [criterion.id, criterion.maxPoints / 2]),
    );
    const summary = summarisePeerReviews(
      [review(perfect), review(middling), review(middling)],
      rubric,
    );

    expect(summary.count).toBe(3);
    expect(summary.mean).toBeCloseTo((100 + 50 + 50) / 3, 6);
    expect(summary.median).toBe(50);
    expect(summary.lowest).toBe(50);
    expect(summary.highest).toBe(100);
  });

  it('separates the two so a rival group marking down is visible', () => {
    // Nine honest scores around 80 and one hostile zero: the mean drops eight
    // points, the median does not move. That gap is the signal.
    const around80 = Object.fromEntries(
      rubric.criteria.map((criterion) => [criterion.id, criterion.maxPoints * 0.8]),
    );
    const zeros = Object.fromEntries(rubric.criteria.map((criterion) => [criterion.id, 0]));

    const honest = Array.from({ length: 9 }, () => review(around80));
    const summary = summarisePeerReviews([...honest, review(zeros)], rubric);

    expect(summary.median).toBeCloseTo(80, 6);
    expect(summary.mean).toBeCloseTo(72, 6);
    expect(summary.lowest).toBe(0);
  });

  it('breaks the picture down by criterion, so the weak part is named', () => {
    const strongAnalysis = { ...perfect, evidence: 3 };
    const summary = summarisePeerReviews([review(strongAnalysis), review(strongAnalysis)], rubric);

    expect(summary.byCriterion.analysis?.mean).toBe(25);
    expect(summary.byCriterion.evidence?.mean).toBe(3);
    expect(summary.byCriterion.evidence?.highest).toBe(3);
  });
});

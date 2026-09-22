import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESENTATION_POLICY,
  computeLatePenalty,
  computeStudentScore,
  isSubmissionLate,
  parsePresentationPolicy,
  roundScore,
  submissionDeadlineFor,
  sumRubricScores,
} from '../index';

const policy = DEFAULT_PRESENTATION_POLICY;

describe('policy defaults match the Case Study Presentation Guide', () => {
  it('validates against its own schema', () => {
    expect(() => parsePresentationPolicy(policy)).not.toThrow();
  });

  it('keeps the format overview of the guide', () => {
    expect(policy.groupSize).toEqual({ min: 4, max: 6 });
    expect(policy.presentation.minMinutes).toBe(18);
    expect(policy.presentation.maxMinutes).toBe(20);
    expect(policy.presentation.hardStopMinutes).toBe(22);
    expect(policy.qa.minMinutes).toBe(8);
    expect(policy.qa.maxMinutes).toBe(10);
    expect(policy.slides).toMatchObject({ min: 14, max: 18 });
    expect(policy.submission.deadlineHoursBeforeSession).toBe(24);
    expect(policy.grading.teamWeight).toBe(0.8);
    expect(policy.grading.individualWeight).toBe(0.2);
    expect(policy.grading.lateSubmissionPenaltyPoints).toBe(10);
  });

  it('carries a 100-point rubric of six criteria', () => {
    expect(policy.rubric.criteria).toHaveLength(6);
    expect(policy.rubric.criteria.reduce((s, c) => s + c.maxPoints, 0)).toBe(100);
    expect(policy.rubric.criteria.map((c) => c.maxPoints)).toEqual([20, 25, 15, 15, 15, 10]);
  });

  it('reserves Delivery and Coordination for the lecturer', () => {
    const delivery = policy.rubric.criteria.find((c) => c.id === 'delivery');
    expect(delivery?.aiAssessable).toBe(false);
  });

  it('rejects weights that do not add up to 1', () => {
    expect(() =>
      parsePresentationPolicy({
        ...policy,
        grading: { ...policy.grading, teamWeight: 0.7, individualWeight: 0.2 },
      }),
    ).toThrow();
  });

  it('rejects a rubric whose criteria do not add up to its total', () => {
    expect(() =>
      parsePresentationPolicy({
        ...policy,
        rubric: {
          ...policy.rubric,
          criteria: policy.rubric.criteria.slice(0, 5),
        },
      }),
    ).toThrow();
  });
});

describe('computeStudentScore', () => {
  it('applies 80% group + 20% individual (SRS 13.1 example)', () => {
    const result = computeStudentScore({ rawScore: 85, isLate: false }, { rawScore: 90 }, policy);
    expect(result.finalScore).toBe(86);
    expect(result.weightedGroup).toBeCloseTo(68);
    expect(result.weightedIndividual).toBeCloseTo(18);
  });

  it('gives different members of one group different final marks', () => {
    const group = { rawScore: 85, isLate: false };
    expect(computeStudentScore(group, { rawScore: 90 }, policy).finalScore).toBe(86);
    expect(computeStudentScore(group, { rawScore: 80 }, policy).finalScore).toBe(84);
    expect(computeStudentScore(group, { rawScore: 95 }, policy).finalScore).toBe(87);
  });

  it('deducts the late penalty from the group score before weighting', () => {
    const result = computeStudentScore({ rawScore: 85, isLate: true }, { rawScore: 90 }, policy);
    expect(result.latePenaltyApplied).toBe(10);
    expect(result.groupScoreAfterPenalty).toBe(75);
    expect(result.finalScore).toBe(78);
  });

  it('honours a lecturer waiver of the late penalty', () => {
    const result = computeStudentScore(
      {
        rawScore: 85,
        isLate: true,
        latePenaltyOverride: { waived: true, reason: 'Hospital admission', byUid: 'uid_lecturer' },
      },
      { rawScore: 90 },
      policy,
    );
    expect(result.latePenaltyApplied).toBe(0);
    expect(result.finalScore).toBe(86);
  });

  it('forfeits the whole individual share when a student does not present', () => {
    const result = computeStudentScore(
      { rawScore: 85, isLate: false },
      { rawScore: 90, didNotPresent: true },
      policy,
    );
    expect(result.individualForfeited).toBe(true);
    expect(result.forfeitReason).toBe('absent');
    expect(result.individualScoreApplied).toBe(0);
    expect(result.finalScore).toBe(68);
  });

  it('forfeits the individual share when the student cannot answer their own role', () => {
    const result = computeStudentScore(
      { rawScore: 85, isLate: false },
      { rawScore: 90, failedOwnRoleQuestion: true },
      policy,
    );
    expect(result.forfeitReason).toBe('unanswered_own_role');
    expect(result.finalScore).toBe(68);
  });

  it('never produces a score outside 0..maxScore', () => {
    expect(
      computeStudentScore({ rawScore: 200, isLate: false }, { rawScore: 200 }, policy).finalScore,
    ).toBe(100);
    expect(
      computeStudentScore({ rawScore: -5, isLate: true }, { rawScore: -5 }, policy).finalScore,
    ).toBe(0);
  });

  it('records the policy version used, so a published grade stays explainable', () => {
    const result = computeStudentScore({ rawScore: 85, isLate: false }, { rawScore: 90 }, policy);
    expect(result.policyId).toBe(policy.id);
    expect(result.policyVersion).toBe(policy.version);
  });

  it('keeps published grades stable when a later policy changes the weights', () => {
    const published = computeStudentScore(
      { rawScore: 85, isLate: false },
      { rawScore: 90 },
      policy,
    );
    const revised = parsePresentationPolicy({
      ...policy,
      version: '2026.2',
      grading: { ...policy.grading, teamWeight: 0.7, individualWeight: 0.3 },
    });
    const recomputed = computeStudentScore(
      { rawScore: 85, isLate: false },
      { rawScore: 90 },
      revised,
    );
    expect(published.finalScore).toBe(86);
    expect(recomputed.finalScore).toBe(87);
    expect(published.policyVersion).not.toBe(recomputed.policyVersion);
  });
});

describe('rounding and penalties', () => {
  it('rounds half away from zero at the configured precision', () => {
    expect(roundScore(86.5, 0)).toBe(87);
    expect(roundScore(85.4, 0)).toBe(85);
    expect(roundScore(85.455, 2)).toBe(85.46);
    expect(roundScore(1.005, 2)).toBe(1.01);
  });

  it('charges no penalty for an on-time submission', () => {
    expect(computeLatePenalty({ rawScore: 80, isLate: false }, policy)).toBe(0);
  });
});

describe('sumRubricScores', () => {
  it('adds up lecturer entries', () => {
    expect(
      sumRubricScores(
        [
          { criterionId: 'understanding', points: 18 },
          { criterionId: 'analysis', points: 22 },
          { criterionId: 'evidence', points: 12 },
          { criterionId: 'critique', points: 13 },
          { criterionId: 'transferDecision', points: 12 },
          { criterionId: 'delivery', points: 8 },
        ],
        policy,
      ),
    ).toBe(85);
  });

  it('rejects an unknown criterion', () => {
    expect(() => sumRubricScores([{ criterionId: 'creativity', points: 5 }], policy)).toThrow(
      /Unknown rubric criterion/,
    );
  });

  it('rejects a score above the criterion maximum', () => {
    expect(() => sumRubricScores([{ criterionId: 'delivery', points: 11 }], policy)).toThrow(
      /outside 0\.\.10/,
    );
  });
});

describe('deadlines use the server clock', () => {
  const sessionStart = Date.UTC(2026, 9, 1, 2, 0, 0);

  it('sets the deadline 24 hours before the session', () => {
    const deadline = submissionDeadlineFor(sessionStart, policy);
    expect(sessionStart - deadline).toBe(24 * 60 * 60 * 1000);
  });

  it('flags a submission arriving after the deadline', () => {
    const deadline = submissionDeadlineFor(sessionStart, policy);
    expect(isSubmissionLate(deadline - 1000, deadline)).toBe(false);
    expect(isSubmissionLate(deadline, deadline)).toBe(false);
    expect(isSubmissionLate(deadline + 1000, deadline)).toBe(true);
  });
});

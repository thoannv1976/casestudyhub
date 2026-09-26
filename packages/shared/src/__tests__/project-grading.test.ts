import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESENTATION_POLICY,
  DEFAULT_PROJECT_RUBRIC,
  computeStudentScore,
  parsePresentationPolicy,
  sumRubricScores,
} from '../index';

/**
 * Marking the class group project.
 *
 * The arithmetic that needs pinning down is the order the three moving parts
 * are applied in: the rubric total, the bonus earned outside it, and the late
 * penalty. Get the order wrong and a bonus quietly cancels out handing in
 * late, which is a fairness decision nobody made.
 */

const policy = DEFAULT_PRESENTATION_POLICY;
const onTime = { isLate: false };

function scoreOf(rawScore: number, bonusPoints: number, isLate = false) {
  return computeStudentScore({ rawScore, bonusPoints, isLate }, { rawScore: 100 }, policy);
}

describe('the project rubric', () => {
  it('adds up to a hundred across the ten components of the guide', () => {
    expect(DEFAULT_PROJECT_RUBRIC.totalPoints).toBe(100);
    expect(DEFAULT_PROJECT_RUBRIC.criteria).toHaveLength(10);
    expect(DEFAULT_PROJECT_RUBRIC.criteria.reduce((sum, item) => sum + item.maxPoints, 0)).toBe(
      100,
    );
  });

  it('is a different instrument from the presentation rubric', () => {
    // Same scale, different work. Sharing one would mean marking a six-week
    // venture with a rubric written for twenty minutes in a room.
    expect(DEFAULT_PROJECT_RUBRIC.id).not.toBe(DEFAULT_PRESENTATION_POLICY.rubric.id);
    const shared = DEFAULT_PROJECT_RUBRIC.criteria
      .map((item) => item.id)
      .filter((id) => DEFAULT_PRESENTATION_POLICY.rubric.criteria.some((c) => c.id === id));
    expect(shared).toEqual([]);
  });

  it('keeps the pitch and teamwork component away from the model', () => {
    // The one thing a model cannot mark: whether the team stood in front of a
    // panel and defended its own decisions.
    const pitch = DEFAULT_PROJECT_RUBRIC.criteria.find((item) => item.id === 'pitch-teamwork');
    expect(pitch?.aiAssessable).toBe(false);
  });

  it('marks against the rubric it is given, not the policy default', () => {
    const entries = DEFAULT_PROJECT_RUBRIC.criteria.map((item) => ({
      criterionId: item.id,
      points: item.maxPoints,
    }));

    expect(sumRubricScores(entries, policy, DEFAULT_PROJECT_RUBRIC)).toBe(100);
    // Against the presentation rubric those criterion ids do not exist at all.
    expect(() => sumRubricScores(entries, policy)).toThrow(/Unknown rubric criterion/);
  });

  it('is defaulted onto a framework version stored before it existed', () => {
    const { projectRubric: _dropped, ...older } = DEFAULT_PRESENTATION_POLICY;
    expect(parsePresentationPolicy(older).projectRubric.id).toBe(DEFAULT_PROJECT_RUBRIC.id);
  });
});

describe('points earned outside the rubric', () => {
  it('adds the bonus to the group score', () => {
    expect(scoreOf(70, 15).groupScoreRaw).toBe(85);
    expect(scoreOf(70, 15).bonusPointsApplied).toBe(15);
  });

  it('caps the total at the scale maximum, and says what was earned', () => {
    const score = scoreOf(95, 15);
    expect(score.groupScoreBeforeCap).toBe(110);
    expect(score.groupScoreRaw).toBe(100);
  });

  it('takes the late penalty after the cap, so a bonus cannot cancel lateness', () => {
    const penalty = policy.grading.lateSubmissionPenaltyPoints;
    const late = scoreOf(95, 15, true);
    const punctual = scoreOf(95, 15);

    expect(late.groupScoreAfterPenalty).toBe(100 - penalty);
    expect(punctual.groupScoreAfterPenalty).toBe(100);
    // The bonus still helped - it is not erased, only outranked.
    expect(late.groupScoreAfterPenalty).toBeGreaterThan(
      scoreOf(95, 0, true).groupScoreAfterPenalty,
    );
  });

  it('changes nothing when there is no bonus, which is every case study', () => {
    const withoutField = computeStudentScore({ rawScore: 80, ...onTime }, { rawScore: 90 }, policy);
    expect(withoutField.bonusPointsApplied).toBe(0);
    expect(withoutField.groupScoreRaw).toBe(80);
  });

  it('still weighs the group at 80 and the student at 20', () => {
    // The guide's split, and the platform already ran on it.
    const score = scoreOf(90, 10);
    expect(score.finalScore).toBe(100 * 0.8 + 100 * 0.2);
  });
});

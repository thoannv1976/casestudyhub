import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESENTATION_POLICY,
  addClassLecturerSchema,
  saveLecturerAssessmentSchema,
} from '../index';

const policy = DEFAULT_PRESENTATION_POLICY;
const fullScores = Object.fromEntries(
  policy.rubric.criteria.map((criterion) => [criterion.id, criterion.maxPoints]),
);

function keysOf(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? [] : (result.error?.issues.map((issue) => issue.message) ?? []);
}

describe('the marking form speaks in translation keys', () => {
  it('names a criterion left blank', () => {
    const keys = keysOf(
      saveLecturerAssessmentSchema.safeParse({
        criterionScores: { understanding: 'not a number' },
        individual: {},
      }),
    );
    expect(keys).toContain('errors.criterionScoreRequired');
  });

  it('names an individual score left blank', () => {
    const keys = keysOf(
      saveLecturerAssessmentSchema.safeParse({
        criterionScores: fullScores,
        individual: { uid1: { rawScore: undefined } },
      }),
    );
    expect(keys).toContain('errors.individualScoreRequired');
  });

  it('refuses a silent waiver of the late penalty', () => {
    // Waiving a penalty without saying why leaves nothing to explain the mark
    // with, months later, when somebody asks.
    const keys = keysOf(
      saveLecturerAssessmentSchema.safeParse({
        criterionScores: fullScores,
        individual: { uid1: { rawScore: 15 } },
        latePenaltyWaived: true,
      }),
    );
    expect(keys).toContain('errors.waiverNeedsReason');
  });

  it('accepts a waiver that carries a reason', () => {
    const result = saveLecturerAssessmentSchema.safeParse({
      criterionScores: fullScores,
      individual: { uid1: { rawScore: 15 } },
      latePenaltyWaived: true,
      latePenaltyWaiverReason: 'Bereavement, confirmed by the faculty office.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a complete marking with no waiver at all', () => {
    const result = saveLecturerAssessmentSchema.safeParse({
      criterionScores: fullScores,
      individual: { uid1: { rawScore: 18, didNotPresent: false } },
    });
    expect(result.success).toBe(true);
    expect(result.data?.latePenaltyWaived).toBe(false);
  });

  it('names a bad email when a class acquires a lecturer', () => {
    expect(keysOf(addClassLecturerSchema.safeParse({ email: 'nope' }))).toContain(
      'errors.emailInvalid',
    );
  });
});

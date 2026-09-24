import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESENTATION_POLICY,
  nextVersionAfter,
  presentationPolicySchema,
  savePolicySchema,
} from '../policy/presentation-policy';

/**
 * The framework as editable data. What is checked here is the schema's refusal
 * to accept a framework that cannot be marked with - the guarantees that stop
 * a faculty publishing a rule the grade engine would then have to guess at.
 */

function edited(changes: Record<string, unknown>) {
  return { ...DEFAULT_PRESENTATION_POLICY, version: '2026.2', ...changes };
}

describe('a framework a mark can be computed from', () => {
  it('accepts a version that only changes numbers', () => {
    const parsed = presentationPolicySchema.safeParse(
      edited({
        presentation: { minMinutes: 10, maxMinutes: 15, hardStopMinutes: 18 },
        qa: { ...DEFAULT_PRESENTATION_POLICY.qa, minClassQuestions: 5 },
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it('refuses weights that do not add to a whole mark', () => {
    const parsed = presentationPolicySchema.safeParse(
      edited({
        grading: { ...DEFAULT_PRESENTATION_POLICY.grading, teamWeight: 0.7, individualWeight: 0.7 },
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it('refuses a hard stop before the longest presentation, which could never fire', () => {
    const parsed = presentationPolicySchema.safeParse(
      edited({ presentation: { minMinutes: 10, maxMinutes: 15, hardStopMinutes: 12 } }),
    );
    expect(parsed.success).toBe(false);
  });

  it('refuses a slide range that excludes every number', () => {
    const parsed = presentationPolicySchema.safeParse(
      edited({ slides: { min: 20, max: 10, excludeCoverAndSources: true } }),
    );
    expect(parsed.success).toBe(false);
  });

  it('refuses a group whose smallest size is larger than its largest', () => {
    const parsed = presentationPolicySchema.safeParse(edited({ groupSize: { min: 6, max: 4 } }));
    expect(parsed.success).toBe(false);
  });

  it('keeps peer assessment and AI advisory, whatever a form sends', () => {
    const parsed = presentationPolicySchema.safeParse(
      edited({
        grading: { ...DEFAULT_PRESENTATION_POLICY.grading, aiScoreIsAdvisoryOnly: false },
      }),
    );
    // `aiScoreIsAdvisoryOnly` is a literal in the schema: a framework that
    // said otherwise would be describing a platform this one is not.
    expect(parsed.success).toBe(false);
  });

  it('refuses to drop version history, which is what keeps an old mark reproducible', () => {
    const parsed = presentationPolicySchema.safeParse(edited({ version: '' }));
    expect(parsed.success).toBe(false);
  });
});

describe('what a request to publish must carry', () => {
  it('needs a reason long enough to be a reason', () => {
    const parsed = savePolicySchema.safeParse({
      policy: edited({}),
      reason: 'because',
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe('errors.policyReasonTooShort');
  });

  it('accepts a framework and a reason together', () => {
    expect(
      savePolicySchema.safeParse({
        policy: edited({}),
        reason: 'The faculty shortened presentations to 12 minutes for 2026.2.',
      }).success,
    ).toBe(true);
  });
});

describe('the next version number', () => {
  it('counts on from a version that ends in one', () => {
    expect(nextVersionAfter('2026.1')).toBe('2026.2');
    expect(nextVersionAfter('2026.9')).toBe('2026.10');
    expect(nextVersionAfter('v3')).toBe('v4');
  });

  it('adds one rather than guessing when the version has no number to count', () => {
    expect(nextVersionAfter('spring')).toBe('spring.1');
  });

  it('starts the platform default at its own successor', () => {
    expect(nextVersionAfter(DEFAULT_PRESENTATION_POLICY.version)).not.toBe(
      DEFAULT_PRESENTATION_POLICY.version,
    );
  });
});

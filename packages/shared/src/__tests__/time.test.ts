import { describe, expect, it } from 'vitest';
import { COURSE_TIME_ZONE, fromZonedInput, toZonedInput } from '../domain/time';

/**
 * The incident these tests are named after: a lecturer set a deadline for
 * 10:10 in Hanoi, every screen showed 03:10, and saving the form again moved
 * the real deadline back another seven hours.
 */
describe('reading and typing a deadline', () => {
  it('shows a stored instant on a Hanoi wall clock', () => {
    // 03:10 UTC is 10:10 in Vietnam, which is what the lecturer typed.
    expect(toZonedInput('2026-10-05T03:10:00.000Z')).toBe('2026-10-05T10:10');
  });

  it('turns what was typed back into the instant it names', () => {
    expect(fromZonedInput('2026-10-05T10:10')).toBe('2026-10-05T03:10:00.000Z');
  });

  it('survives a round trip, which is the bug that moved real deadlines', () => {
    const stored = '2026-10-05T03:10:00.000Z';
    // Open the form, save it again without touching the field.
    const once = fromZonedInput(toZonedInput(stored));
    expect(once).toBe(stored);
    // And again. The old code lost seven hours on every pass.
    expect(fromZonedInput(toZonedInput(once ?? ''))).toBe(stored);
  });

  it('crosses midnight without changing the day', () => {
    // 20:00 UTC is 03:00 the next morning in Vietnam.
    expect(toZonedInput('2026-10-05T20:00:00.000Z')).toBe('2026-10-06T03:00');
    expect(fromZonedInput('2026-10-06T03:00')).toBe('2026-10-05T20:00:00.000Z');
  });

  it('handles midnight itself, which some runtimes call hour 24', () => {
    // 17:00 UTC is exactly midnight in Vietnam.
    expect(toZonedInput('2026-10-05T17:00:00.000Z')).toBe('2026-10-06T00:00');
    expect(fromZonedInput('2026-10-06T00:00')).toBe('2026-10-05T17:00:00.000Z');
  });

  it('gives an empty field rather than a crash for nothing', () => {
    expect(toZonedInput(null)).toBe('');
    expect(toZonedInput('')).toBe('');
    expect(toZonedInput('not a date')).toBe('');
    expect(fromZonedInput('')).toBeNull();
    expect(fromZonedInput('05/10/2026 10:10')).toBeNull();
  });

  it('names the zone it decided on, so a course elsewhere can change it', () => {
    expect(COURSE_TIME_ZONE).toBe('Asia/Ho_Chi_Minh');
    expect(toZonedInput('2026-10-05T03:10:00.000Z', 'UTC')).toBe('2026-10-05T03:10');
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESENTATION_POLICY,
  assignmentProgress,
  currentVersionsOf,
  matchesFilter,
  type ProgressInput,
} from '../index';

/**
 * Where a group has got to. This decides which rows a lecturer is shown as
 * needing them, so the line between "still has time" and "overdue" is worth
 * pinning down rather than leaving to whichever page asks.
 */

const required = DEFAULT_PRESENTATION_POLICY.deliverables.filter((item) => item.required);
const NOW = Date.parse('2026-03-10T09:00:00.000Z');
const HOUR = 3_600_000;

function progress(overrides: Partial<ProgressInput> = {}) {
  return assignmentProgress({
    requiredDeliverables: DEFAULT_PRESENTATION_POLICY.deliverables,
    submitted: [],
    submissionDeadline: new Date(NOW + 24 * HOUR).toISOString(),
    nowMs: NOW,
    marked: false,
    published: false,
    ...overrides,
  });
}

const everything = required.map((item) => ({ deliverableId: item.id, isLate: false }));

describe('a group that has not finished', () => {
  it('is waiting, not late, while the deadline is still ahead', () => {
    const result = progress();
    expect(result.state).toBe('awaiting');
    expect(result.missing).toBe(required.length);
    // Chasing a group that is merely unfinished is not the lecturer's job yet.
    expect(result.needsLecturer).toBe(false);
  });

  it('becomes overdue once the deadline has passed, and then it is the lecturer’s', () => {
    const result = progress({ submissionDeadline: new Date(NOW - HOUR).toISOString() });
    expect(result.state).toBe('overdue');
    expect(result.needsLecturer).toBe(true);
  });

  it('counts only what is still missing, not what was never required', () => {
    const [first] = required;
    const result = progress({ submitted: [{ deliverableId: first!.id, isLate: false }] });
    expect(result.missing).toBe(required.length - 1);
  });

  it('treats a deadline that is not a date as no deadline rather than as passed', () => {
    expect(progress({ submissionDeadline: 'sometime' }).state).toBe('awaiting');
  });
});

describe('a group that has handed everything in', () => {
  it('is ready to mark, and that is the lecturer’s to do', () => {
    const result = progress({ submitted: everything });
    expect(result.state).toBe('complete');
    expect(result.missing).toBe(0);
    expect(result.needsLecturer).toBe(true);
  });

  it('is still ready to mark when something arrived late - late is not missing', () => {
    const late = everything.map((item, index) => ({ ...item, isLate: index === 0 }));
    const result = progress({
      submitted: late,
      submissionDeadline: new Date(NOW - HOUR).toISOString(),
    });
    expect(result.state).toBe('complete');
    expect(result.lateItems).toBe(1);
  });
});

describe('once a lecturer has been involved', () => {
  it('shows a draft mark as waiting on them to publish', () => {
    const result = progress({ submitted: everything, marked: true });
    expect(result.state).toBe('marked');
    expect(result.needsLecturer).toBe(true);
  });

  it('shows a published mark as finished, and asks nothing more of them', () => {
    const result = progress({ submitted: everything, marked: true, published: true });
    expect(result.state).toBe('published');
    expect(result.needsLecturer).toBe(false);
  });

  it('does not call a published assignment overdue, whatever was never handed in', () => {
    // The lecturer marked it knowing something was missing. Saying "overdue"
    // afterwards would contradict a decision already taken.
    const result = progress({
      submitted: [],
      submissionDeadline: new Date(NOW - HOUR).toISOString(),
      marked: true,
      published: true,
    });
    expect(result.state).toBe('published');
    expect(result.missing).toBe(required.length);
  });
});

describe('the filter a lecturer works through', () => {
  it('lets everything through on "all"', () => {
    expect(matchesFilter(progress(), 'all')).toBe(true);
  });

  it('gathers every state that needs them, across different reasons', () => {
    const overdue = progress({ submissionDeadline: new Date(NOW - HOUR).toISOString() });
    const ready = progress({ submitted: everything });
    const done = progress({ submitted: everything, marked: true, published: true });

    expect(matchesFilter(overdue, 'needsLecturer')).toBe(true);
    expect(matchesFilter(ready, 'needsLecturer')).toBe(true);
    expect(matchesFilter(done, 'needsLecturer')).toBe(false);
  });

  it('matches one state exactly when one is named', () => {
    expect(matchesFilter(progress(), 'awaiting')).toBe(true);
    expect(matchesFilter(progress(), 'overdue')).toBe(false);
  });
});

describe('which version of a deliverable counts', () => {
  it('keeps the newest of each, because a resubmission never overwrites', () => {
    const current = currentVersionsOf([
      { deliverableId: 'slides-pdf', versionNumber: 1, isLate: true },
      { deliverableId: 'slides-pdf', versionNumber: 3, isLate: false },
      { deliverableId: 'report', versionNumber: 1, isLate: false },
    ]);

    expect(current).toHaveLength(2);
    expect(current.find((item) => item.deliverableId === 'slides-pdf')?.versionNumber).toBe(3);
    // The first attempt was late; the one that counts was not.
    expect(current.find((item) => item.deliverableId === 'slides-pdf')?.isLate).toBe(false);
  });

  it('handles an empty list rather than assuming there is always one', () => {
    expect(currentVersionsOf([])).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { askerTally, reconcileClusters, volunteeringWindow } from '../index';

/**
 * Volunteering to present, and the two tallies around it.
 *
 * All three are pure, and all three are read out loud to a room: how many
 * places are left, who still owes a question, and which questions belong
 * together. Being wrong in front of a class is the cost of getting them wrong.
 */

describe('whether a group may still volunteer', () => {
  const project = { presentationSlots: 2, volunteerDeadline: undefined };
  const now = Date.parse('2026-05-01T10:00:00Z');

  it('is closed until the lecturer opens it', () => {
    expect(volunteeringWindow({ ...project, presentationSlots: 0 }, 0, now)).toEqual({
      open: false,
      closedBecause: 'notOpened',
    });
  });

  it('is open while a place is left', () => {
    expect(volunteeringWindow(project, 1, now)).toEqual({ open: true, closedBecause: null });
  });

  it('closes on the last place, not after it', () => {
    // Two places and two volunteers is full; a third must not squeeze in.
    expect(volunteeringWindow(project, 2, now).closedBecause).toBe('full');
    expect(volunteeringWindow(project, 3, now).closedBecause).toBe('full');
  });

  it('closes at the deadline, by the server clock', () => {
    const withDeadline = { ...project, volunteerDeadline: '2026-05-01T09:00:00Z' };
    expect(volunteeringWindow(withDeadline, 0, now).closedBecause).toBe('deadline');
    expect(volunteeringWindow(withDeadline, 0, Date.parse('2026-05-01T08:59:00Z')).open).toBe(true);
  });

  it('being full outranks a deadline that has not arrived', () => {
    // Both are reasons; the one a group can do nothing about is the useful one.
    const withDeadline = { ...project, volunteerDeadline: '2026-06-01T09:00:00Z' };
    expect(volunteeringWindow(withDeadline, 2, now).closedBecause).toBe('full');
  });

  it('ignores a deadline it cannot read rather than closing the floor', () => {
    expect(volunteeringWindow({ ...project, volunteerDeadline: 'next Friday' }, 0, now).open).toBe(
      true,
    );
  });
});

describe('who still owes a question', () => {
  it('leaves the presenting group out of the count', () => {
    // They answer questions; counting them as silent would make the tally a lie
    // the lecturer reads out loud.
    const tally = askerTally({
      classUids: ['a', 'b', 'c', 'd'],
      presenterUids: ['c', 'd'],
      askerUids: ['a'],
    });

    expect(tally.expected).toBe(2);
    expect(tally.asked).toBe(1);
    expect(tally.missing).toBe(1);
    expect(tally.missingUids).toEqual(['b']);
  });

  it('does not count a presenter who asked anyway', () => {
    const tally = askerTally({
      classUids: ['a', 'b'],
      presenterUids: ['b'],
      askerUids: ['a', 'b'],
    });
    expect(tally.expected).toBe(1);
    expect(tally.asked).toBe(1);
  });

  it('counts a student once however many times the roster lists them', () => {
    const tally = askerTally({ classUids: ['a', 'a'], presenterUids: [], askerUids: [] });
    expect(tally.expected).toBe(1);
  });

  it('says everyone is owing when nobody has asked', () => {
    const tally = askerTally({ classUids: ['a', 'b'], presenterUids: [], askerUids: [] });
    expect(tally).toMatchObject({ expected: 2, asked: 0, missing: 2 });
  });
});

describe('the model’s grouping, brought back to reality', () => {
  const ids = ['q1', 'q2', 'q3', 'q4'];

  it('keeps the themes it proposed', () => {
    const result = reconcileClusters(
      [
        { title: 'Unit economics', questionIds: ['q1', 'q2'] },
        { title: 'Customer evidence', questionIds: ['q3'] },
      ],
      ids,
    );

    expect(result.clusters).toHaveLength(2);
    expect(result.unclustered).toEqual(['q4']);
  });

  it('drops an id the model invented rather than showing a theme pointing at nothing', () => {
    const result = reconcileClusters([{ title: 'Pricing', questionIds: ['q1', 'q99'] }], ids);
    expect(result.clusters[0]?.questionIds).toEqual(['q1']);
  });

  it('puts a question in the first theme that claims it, never two', () => {
    const result = reconcileClusters(
      [
        { title: 'Pricing', questionIds: ['q1'] },
        { title: 'Margins', questionIds: ['q1', 'q2'] },
      ],
      ids,
    );

    expect(result.clusters[0]?.questionIds).toEqual(['q1']);
    expect(result.clusters[1]?.questionIds).toEqual(['q2']);
  });

  it('drops a theme left with nothing in it, and one with no title', () => {
    const result = reconcileClusters(
      [
        { title: 'Ghosts', questionIds: ['q98', 'q99'] },
        { title: '   ', questionIds: ['q1'] },
      ],
      ids,
    );
    expect(result.clusters).toEqual([]);
    expect(result.unclustered).toEqual(ids);
  });

  it('lists everything as unclustered when the model returned nothing', () => {
    expect(reconcileClusters([], ids).unclustered).toEqual(ids);
  });
});

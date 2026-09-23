import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESENTATION_POLICY,
  cloAttainment,
  criterionAverages,
  distributionOf,
  participationOf,
  toCsv,
} from '../index';

const rubric = DEFAULT_PRESENTATION_POLICY.rubric;

describe('how a cohort is spread', () => {
  it('reports nothing rather than zero for an unmarked class', () => {
    const distribution = distributionOf([]);
    expect(distribution.count).toBe(0);
    expect(distribution.rows.every((row) => row.count === 0 && row.share === 0)).toBe(true);
  });

  it('puts every score in exactly one band, including the very top', () => {
    const scores = [100, 85, 84, 70, 69, 55, 54, 0];
    const distribution = distributionOf(scores);

    expect(distribution.rows.reduce((sum, row) => sum + row.count, 0)).toBe(scores.length);
    // 100 and 85 are excellent; 84 and 70 good; 69 and 55 fair; 54 and 0 weak.
    expect(distribution.rows.map((row) => row.count)).toEqual([2, 2, 2, 2]);
  });

  it('shows the mean and median together, so one outlier is visible', () => {
    const distribution = distributionOf([80, 80, 80, 80, 0]);
    expect(distribution.mean).toBe(64);
    expect(distribution.median).toBe(80);
    expect(distribution.lowest).toBe(0);
  });
});

describe('where a cohort is thin', () => {
  it('compares criteria by share, not by raw points', () => {
    // 14 of 25 on analysis, 12 of 15 on evidence. Analysis carries the larger
    // raw mean and the weaker performance; only the share says so.
    const averages = criterionAverages([{ scores: { evidence: 12, analysis: 14 } }], rubric);

    const evidence = averages.find((row) => row.criterionId === 'evidence');
    const analysis = averages.find((row) => row.criterionId === 'analysis');

    expect(analysis?.mean).toBeGreaterThan(evidence?.mean ?? 0);
    expect(analysis?.meanShare).toBeCloseTo(0.56, 6);
    expect(evidence?.meanShare).toBeCloseTo(0.8, 6);
    expect(analysis?.meanShare).toBeLessThan(evidence?.meanShare ?? 0);
  });

  it('counts only the work that was actually marked on a criterion', () => {
    const averages = criterionAverages(
      [{ scores: { evidence: 15 } }, { scores: { analysis: 10 } }],
      rubric,
    );
    expect(averages.find((row) => row.criterionId === 'evidence')?.count).toBe(1);
  });
});

describe('CLO attainment', () => {
  it('counts only criteria that claim to measure the outcome', () => {
    // CLO6 is claimed by critique and transferDecision, not by evidence.
    const attainment = cloAttainment(
      [{ scores: { critique: 15, transferDecision: 15, evidence: 0 } }],
      rubric,
      0.5,
    );

    const clo6 = attainment.find((row) => row.cloId === 'CLO6');
    expect(clo6?.criterionIds.sort()).toEqual(['critique', 'transferDecision']);
    expect(clo6?.attainment).toBe(1);
  });

  it('weights by the points a criterion carries, not by criterion count', () => {
    // CLO1: understanding (20) and analysis (25) and evidence (15).
    // Full marks on the 25, nothing on the other two: 25/60, not 1/3.
    const attainment = cloAttainment(
      [{ scores: { understanding: 0, analysis: 25, evidence: 0 } }],
      rubric,
      0.5,
    );

    const clo1 = attainment.find((row) => row.cloId === 'CLO1');
    expect(clo1?.attainment).toBeCloseTo(25 / 60, 6);
  });

  it('reports the share of work that reached the faculty threshold', () => {
    const attainment = cloAttainment(
      [
        { scores: { critique: 15, transferDecision: 15 } },
        { scores: { critique: 3, transferDecision: 3 } },
      ],
      rubric,
      0.5,
    );

    const clo6 = attainment.find((row) => row.cloId === 'CLO6');
    expect(clo6?.atOrAboveThreshold).toBe(0.5);
    expect(clo6?.count).toBe(2);
  });

  it('does not count a criterion nobody marked as a zero', () => {
    // An unmarked criterion is missing evidence, not evidence of failure.
    const attainment = cloAttainment([{ scores: { critique: 15 } }], rubric, 0.5);
    const clo6 = attainment.find((row) => row.cloId === 'CLO6');
    expect(clo6?.attainment).toBe(1);
  });

  it('says nothing at all when there is nothing marked', () => {
    const attainment = cloAttainment([], rubric, 0.5);
    expect(attainment.every((row) => row.count === 0 && row.attainment === 0)).toBe(true);
    expect(attainment.map((row) => row.cloId)).toEqual(['CLO1', 'CLO2', 'CLO4', 'CLO6']);
  });
});

describe('who took part', () => {
  it('names the students who did nothing at all', () => {
    const participation = participationOf({
      enrolledUids: ['a', 'b', 'c', 'd'],
      askedUids: ['a', 'b'],
      answeredUids: ['b'],
      scoredUids: ['c'],
    });

    expect(participation.silentUids).toEqual(['d']);
    expect(participation.askedShare).toBe(0.5);
    expect(participation.scoredShare).toBe(0.25);
  });

  it('ignores someone who left the class but whose question remains', () => {
    const participation = participationOf({
      enrolledUids: ['a'],
      askedUids: ['a', 'departed'],
      answeredUids: [],
      scoredUids: [],
    });
    expect(participation.asked).toBe(1);
    expect(participation.askedShare).toBe(1);
  });
});

describe('exporting a report', () => {
  it('keeps a comma, a quote and a newline inside their own cell', () => {
    const csv = toCsv([
      ['name', 'note'],
      ['Nguyen Van A', 'Strong, but said "maybe"\nand stopped'],
    ]);
    expect(csv.split('\r\n')).toHaveLength(2);
    expect(csv).toContain('"Strong, but said ""maybe""\nand stopped"');
  });

  it('defuses a cell a spreadsheet would run as a formula', () => {
    // Student names and free-text notes end up in these files, and a name
    // beginning with = is executed when the file is opened.
    const csv = toCsv([['=1+1', '+A1', '-cmd', '@SUM(A1)']]);
    expect(csv).toBe(`"'=1+1","'+A1","'-cmd","'@SUM(A1)"`);
  });
});

import type { Rubric } from '../domain/rubric';

/**
 * Class and CLO analytics (SRS Module 14).
 *
 * Pure functions over marks that already exist. Nothing here computes a grade
 * or changes one; it reports what was awarded, so a course team can see where
 * a cohort is strong and where it is not.
 *
 * The CLO mapping these numbers rest on is the illustrative one in the rubric
 * (SRS 14.4). It must be confirmed against the syllabus before any of this is
 * used for formal CLO attainment reporting, and every report says so.
 */

export interface ScoreBand {
  key: string;
  /** Inclusive lower bound, on the policy's own scale. */
  from: number;
  /** Exclusive upper bound, except for the top band. */
  to: number;
}

/**
 * Bands as data, so a faculty using a different scale changes this and not a
 * chart. The default follows the Guide's attainment thresholds.
 */
export const DEFAULT_SCORE_BANDS: readonly ScoreBand[] = [
  { key: 'excellent', from: 85, to: 100.0001 },
  { key: 'good', from: 70, to: 85 },
  { key: 'fair', from: 55, to: 70 },
  { key: 'weak', from: 0, to: 55 },
];

export interface DistributionRow {
  key: string;
  count: number;
  share: number;
}

export interface Distribution {
  rows: DistributionRow[];
  count: number;
  mean: number;
  median: number;
  lowest: number;
  highest: number;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function distributionOf(
  scores: readonly number[],
  bands: readonly ScoreBand[] = DEFAULT_SCORE_BANDS,
): Distribution {
  const rows = bands.map((band) => {
    const count = scores.filter((score) => score >= band.from && score < band.to).length;
    return { key: band.key, count, share: scores.length === 0 ? 0 : count / scores.length };
  });

  return {
    rows,
    count: scores.length,
    mean: scores.length === 0 ? 0 : scores.reduce((sum, score) => sum + score, 0) / scores.length,
    median: median(scores),
    lowest: scores.length === 0 ? 0 : Math.min(...scores),
    highest: scores.length === 0 ? 0 : Math.max(...scores),
  };
}

export interface CriterionScores {
  /** Points awarded per criterion id, from one marked assignment. */
  scores: Record<string, number>;
}

export interface CriterionAverage {
  criterionId: string;
  maxPoints: number;
  mean: number;
  /** Mean as a share of the criterion's own maximum, for comparing criteria. */
  meanShare: number;
  count: number;
}

/**
 * Where a cohort is strong and where it is thin. Shares rather than raw points,
 * because a criterion worth 25 and one worth 10 cannot be compared otherwise.
 */
export function criterionAverages(
  marked: readonly CriterionScores[],
  rubric: Rubric,
): CriterionAverage[] {
  return rubric.criteria.map((criterion) => {
    const values = marked
      .map((entry) => entry.scores[criterion.id])
      .filter((value): value is number => typeof value === 'number');

    const mean =
      values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

    return {
      criterionId: criterion.id,
      maxPoints: criterion.maxPoints,
      mean,
      meanShare: criterion.maxPoints === 0 ? 0 : mean / criterion.maxPoints,
      count: values.length,
    };
  });
}

export interface CloAttainment {
  cloId: string;
  /** Criteria in the rubric that claim to measure this outcome. */
  criterionIds: string[];
  /** Points available for it across all the marked work counted here. */
  maxPoints: number;
  /** Mean share achieved, weighted by each criterion's own weight. */
  attainment: number;
  /** Share of marked work that reached the threshold for this outcome. */
  atOrAboveThreshold: number;
  count: number;
}

/**
 * CLO attainment, computed only from criteria that claim to measure it.
 *
 * Weighted by each criterion's points: a criterion worth 25 says more about an
 * outcome than one worth 10, and averaging their percentages would pretend
 * otherwise. `threshold` is the share a piece of work must reach to count as
 * having met the outcome; it belongs to the faculty, not to this function, so
 * it is a parameter with no clever default.
 */
export function cloAttainment(
  marked: readonly CriterionScores[],
  rubric: Rubric,
  threshold: number,
): CloAttainment[] {
  const cloIds = [...new Set(rubric.criteria.flatMap((criterion) => criterion.cloIds))].sort();

  return cloIds.map((cloId) => {
    const criteria = rubric.criteria.filter((criterion) => criterion.cloIds.includes(cloId));
    const maxPoints = criteria.reduce((sum, criterion) => sum + criterion.maxPoints, 0);

    const shares = marked
      .map((entry) => {
        const awarded = criteria.reduce(
          (sum, criterion) => sum + (entry.scores[criterion.id] ?? 0),
          0,
        );
        const available = criteria.reduce(
          (sum, criterion) =>
            sum + (entry.scores[criterion.id] === undefined ? 0 : criterion.maxPoints),
          0,
        );
        return available === 0 ? null : awarded / available;
      })
      .filter((share): share is number => share !== null);

    return {
      cloId,
      criterionIds: criteria.map((criterion) => criterion.id),
      maxPoints,
      attainment:
        shares.length === 0 ? 0 : shares.reduce((sum, share) => sum + share, 0) / shares.length,
      atOrAboveThreshold:
        shares.length === 0
          ? 0
          : shares.filter((share) => share >= threshold).length / shares.length,
      count: shares.length,
    };
  });
}

export interface ParticipationInput {
  /** Students enrolled and active in the class. */
  enrolledUids: readonly string[];
  /** Students who asked at least one question. */
  askedUids: readonly string[];
  /** Students who answered at least one question aloud. */
  answeredUids: readonly string[];
  /** Students who submitted at least one peer score. */
  scoredUids: readonly string[];
}

export interface Participation {
  enrolled: number;
  asked: number;
  answered: number;
  scored: number;
  askedShare: number;
  answeredShare: number;
  scoredShare: number;
  /** Named, because these are the students to talk to. */
  silentUids: string[];
}

/**
 * Who took part. The list of students who did nothing at all is the useful
 * part: a percentage tells a lecturer the cohort was quiet, a list tells them
 * whom to ask.
 */
export function participationOf(input: ParticipationInput): Participation {
  const asked = new Set(input.askedUids);
  const answered = new Set(input.answeredUids);
  const scored = new Set(input.scoredUids);
  const enrolled = input.enrolledUids.length;

  const share = (count: number) => (enrolled === 0 ? 0 : count / enrolled);
  const countIn = (set: Set<string>) => input.enrolledUids.filter((uid) => set.has(uid)).length;

  return {
    enrolled,
    asked: countIn(asked),
    answered: countIn(answered),
    scored: countIn(scored),
    askedShare: share(countIn(asked)),
    answeredShare: share(countIn(answered)),
    scoredShare: share(countIn(scored)),
    silentUids: input.enrolledUids.filter(
      (uid) => !asked.has(uid) && !answered.has(uid) && !scored.has(uid),
    ),
  };
}

/** A CSV cell that cannot break the row, or be read as a formula. */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  // A leading =, +, - or @ is executed by spreadsheet software when the file
  // is opened. Student names and free-text notes end up in these files.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

import { z } from 'zod';
import type { Rubric } from './rubric';

/**
 * Peer assessment (SRS Module 11).
 *
 * The class scores the group that has just presented, against the same rubric
 * the lecturer uses. What the score is *for* is the decision that shapes this
 * whole module: it is evidence, not arithmetic. Nothing here is added to a
 * final mark. The lecturer reads the distribution the way they would read the
 * room, and decides.
 */

export const peerReviewSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  classId: z.string().min(1),
  caseStudyId: z.string().min(1),
  /** The group being scored. */
  groupId: z.string().min(1),
  reviewerUid: z.string().min(1),
  reviewerName: z.string().min(1),
  reviewerStudentId: z.string().min(1),
  /** The reviewer's own group, so a lecturer can see who scored whom. */
  reviewerGroupId: z.string().nullable().default(null),
  /** One score per rubric criterion, keyed by criterion id. */
  scores: z.record(z.string(), z.number().nonnegative()),
  total: z.number().nonnegative(),
  comment: z.string().max(2000).optional(),
  rubricId: z.string().min(1),
  rubricVersion: z.string().min(1),
  submittedAt: z.string().min(1),
});
export type PeerReview = z.infer<typeof peerReviewSchema>;

export const submitPeerReviewSchema = z.object({
  scores: z.record(z.string(), z.number({ error: 'errors.peerScoreRequired' }).nonnegative()),
  comment: z.string().trim().max(2000).optional(),
});
export type SubmitPeerReviewRequest = z.infer<typeof submitPeerReviewSchema>;

/**
 * Checks a set of scores against the rubric the class was given. Every
 * criterion must be scored, and none above its own maximum - a peer score of
 * 30 on a criterion worth 20 is not a strong opinion, it is a mistake.
 */
export function validatePeerScores(
  scores: Record<string, number>,
  rubric: Rubric,
): { ok: true; total: number } | { ok: false; messageKey: string; criterionId?: string } {
  let total = 0;

  for (const criterion of rubric.criteria) {
    const score = scores[criterion.id];
    if (score === undefined || Number.isNaN(score)) {
      return { ok: false, messageKey: 'errors.peerScoreRequired', criterionId: criterion.id };
    }
    if (score < 0 || score > criterion.maxPoints) {
      return { ok: false, messageKey: 'errors.peerScoreOutOfRange', criterionId: criterion.id };
    }
    total += score;
  }

  const extra = Object.keys(scores).filter(
    (id) => !rubric.criteria.some((criterion) => criterion.id === id),
  );
  if (extra.length > 0) return { ok: false, messageKey: 'errors.peerScoreUnknownCriterion' };

  return { ok: true, total };
}

export interface PeerSummary {
  count: number;
  mean: number;
  median: number;
  lowest: number;
  highest: number;
  /** Per criterion, keyed by criterion id. */
  byCriterion: Record<string, { mean: number; lowest: number; highest: number }>;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * What the lecturer reads: the shape of the class's opinion, not a number to
 * paste into a grade. The median sits beside the mean on purpose - one
 * friendly group marking a rival down moves the mean and leaves the median
 * alone, and that difference is exactly what the lecturer needs to notice.
 */
export function summarisePeerReviews(reviews: readonly PeerReview[], rubric: Rubric): PeerSummary {
  const totals = reviews.map((review) => review.total);
  const byCriterion: PeerSummary['byCriterion'] = {};

  for (const criterion of rubric.criteria) {
    const values = reviews
      .map((review) => review.scores[criterion.id])
      .filter((value): value is number => typeof value === 'number');

    byCriterion[criterion.id] = {
      mean: values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length,
      lowest: values.length === 0 ? 0 : Math.min(...values),
      highest: values.length === 0 ? 0 : Math.max(...values),
    };
  }

  return {
    count: reviews.length,
    mean: totals.length === 0 ? 0 : totals.reduce((sum, value) => sum + value, 0) / totals.length,
    median: median(totals),
    lowest: totals.length === 0 ? 0 : Math.min(...totals),
    highest: totals.length === 0 ? 0 : Math.max(...totals),
    byCriterion,
  };
}

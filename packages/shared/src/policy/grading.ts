import type { PresentationPolicy } from './presentation-policy';

/**
 * Grade calculation engine (SRS Module 13).
 *
 * Every number the engine produces is derived from a policy version, so a
 * published grade can always be recomputed and explained. The lecturer may
 * override a penalty, but an override must carry a reason and is recorded.
 */

export interface LatePenaltyOverride {
  waived: boolean;
  reason: string;
  byUid: string;
}

export interface GroupScoreInput {
  /** Raw rubric total awarded to the group, on the policy's max scale. */
  rawScore: number;
  isLate: boolean;
  latePenaltyOverride?: LatePenaltyOverride;
}

export interface IndividualScoreInput {
  /** Raw individual score for role performance and Q&A quality. */
  rawScore: number;
  /** The student did not present at all. */
  didNotPresent?: boolean;
  /** The student could not answer a question belonging to their own role. */
  failedOwnRoleQuestion?: boolean;
}

export interface ScoreBreakdown {
  groupScoreRaw: number;
  latePenaltyApplied: number;
  groupScoreAfterPenalty: number;
  individualScoreRaw: number;
  individualForfeited: boolean;
  forfeitReason: 'absent' | 'unanswered_own_role' | null;
  individualScoreApplied: number;
  weightedGroup: number;
  weightedIndividual: number;
  finalScore: number;
  policyId: string;
  policyVersion: string;
}

export function roundScore(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  // Scaling through the decimal string avoids the binary floating point error
  // that makes `1.005 * 100` land on 100.49999999999999 and round down.
  const magnitude = Math.abs(value);
  const scaled = Math.round(Number(`${magnitude}e${decimals}`));
  const unscaled = Number(`${scaled}e-${decimals}`);
  return value < 0 ? -unscaled : unscaled;
}

export function clampScore(value: number, maxScore: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(Math.max(value, 0), maxScore);
}

/** Late penalty in points, honouring a lecturer waiver. */
export function computeLatePenalty(
  group: GroupScoreInput,
  policy: Pick<PresentationPolicy, 'grading'>,
): number {
  if (!group.isLate) return 0;
  if (group.latePenaltyOverride?.waived) return 0;
  return policy.grading.lateSubmissionPenaltyPoints;
}

/**
 * Final mark for one student:
 *   final = teamWeight * groupScoreAfterPenalty + individualWeight * individualScore
 * A student who did not present, or who could not answer a question owned by
 * their own role, forfeits the entire individual share (Guide, thresholds).
 */
export function computeStudentScore(
  group: GroupScoreInput,
  individual: IndividualScoreInput,
  policy: PresentationPolicy,
): ScoreBreakdown {
  const { grading } = policy;

  const groupScoreRaw = clampScore(group.rawScore, grading.maxScore);
  const latePenaltyApplied = computeLatePenalty(group, policy);
  const groupScoreAfterPenalty = clampScore(groupScoreRaw - latePenaltyApplied, grading.maxScore);

  const individualScoreRaw = clampScore(individual.rawScore, grading.maxScore);

  let forfeitReason: ScoreBreakdown['forfeitReason'] = null;
  if (grading.forfeitIndividualIfAbsent && individual.didNotPresent) {
    forfeitReason = 'absent';
  } else if (grading.forfeitIndividualIfUnansweredOwnRole && individual.failedOwnRoleQuestion) {
    forfeitReason = 'unanswered_own_role';
  }
  const individualForfeited = forfeitReason !== null;
  const individualScoreApplied = individualForfeited ? 0 : individualScoreRaw;

  const weightedGroup = groupScoreAfterPenalty * grading.teamWeight;
  const weightedIndividual = individualScoreApplied * grading.individualWeight;

  return {
    groupScoreRaw,
    latePenaltyApplied,
    groupScoreAfterPenalty,
    individualScoreRaw,
    individualForfeited,
    forfeitReason,
    individualScoreApplied,
    weightedGroup,
    weightedIndividual,
    finalScore: roundScore(weightedGroup + weightedIndividual, grading.decimals),
    policyId: policy.id,
    policyVersion: policy.version,
  };
}

export interface RubricScoreEntry {
  criterionId: string;
  points: number;
}

/**
 * Sums lecturer rubric entries, rejecting a criterion that does not exist in
 * the rubric version being used or a score above its maximum.
 */
export function sumRubricScores(
  entries: readonly RubricScoreEntry[],
  policy: PresentationPolicy,
): number {
  const byId = new Map(policy.rubric.criteria.map((c) => [c.id, c]));
  let total = 0;
  for (const entry of entries) {
    const criterion = byId.get(entry.criterionId);
    if (!criterion) {
      throw new Error(
        `Unknown rubric criterion "${entry.criterionId}" for rubric ${policy.rubric.id}@${policy.rubric.version}`,
      );
    }
    if (entry.points < 0 || entry.points > criterion.maxPoints) {
      throw new Error(
        `Score ${entry.points} is outside 0..${criterion.maxPoints} for criterion "${entry.criterionId}"`,
      );
    }
    total += entry.points;
  }
  return roundScore(total, policy.grading.decimals);
}

/** A submission is late when it lands after the deadline held on the server. */
export function isSubmissionLate(submittedAtMs: number, deadlineMs: number): boolean {
  return submittedAtMs > deadlineMs;
}

/** Deadline derived from the session start and the policy's lead time. */
export function submissionDeadlineFor(
  presentationStartMs: number,
  policy: Pick<PresentationPolicy, 'submission'>,
): number {
  return presentationStartMs - policy.submission.deadlineHoursBeforeSession * 60 * 60 * 1000;
}

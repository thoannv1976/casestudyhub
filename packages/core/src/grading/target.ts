import {
  type GradedWorkKind,
  type PresentationPolicy,
  type ProjectBonusAward,
  type Rubric,
} from '@casestudyhub/shared';
import { getAssignment } from '../assignments/assignments';
import { getPolicy, policyOfAssignment } from '../policy/policy-store';
import { projectTargetOf } from '../projects/projects';
import { AppError } from '../errors';

/**
 * A piece of work that can be marked, of either kind.
 *
 * A class study assignment and the class group project are marked by the same
 * machinery - one draft, one preview, one transaction that publishes for the
 * whole group or for nobody - but with different instruments. Resolving them
 * to one shape here is what keeps that machinery single. Everything below
 * reads `rubric` and `bonusFor`; none of it branches on the kind except where
 * the two genuinely differ.
 */
export interface GradableTarget {
  id: string;
  kind: GradedWorkKind;
  classId: string;
  groupId: string;
  caseStudyId?: string;
  policy: PresentationPolicy;
  rubric: Rubric;
  rubricVersion: string;
  policyId: string;
  policyVersion: string;
  /** Points the award is worth under the frozen framework. Zero for a case study. */
  bonusPoints: (award: ProjectBonusAward | undefined) => number;
  /**
   * What the model is allowed to read, and what to call each document when it
   * cites one.
   *
   * A list of ids rather than a flag on the deliverable, kept in this one
   * place: the role allocation sheet and the AI disclosure are things a marker
   * checks, not evidence for a rubric criterion, and sending them would spend
   * tokens to make the model's reading noisier. When the framework editor can
   * carry a "the model may read this" flag, this moves there and the ids go.
   */
  readable: Record<string, string>;
}

export async function gradableTarget(id: string): Promise<GradableTarget> {
  const project = await projectTargetOf(id);
  if (project) {
    const policy = await getPolicy(project.policyId, project.policyVersion);
    return {
      id: project.id,
      kind: 'group_project',
      classId: project.classId,
      groupId: project.groupId,
      policy,
      rubric: policy.projectRubric,
      rubricVersion: policy.projectRubric.version,
      policyId: project.policyId,
      policyVersion: project.policyVersion,
      bonusPoints: (award) =>
        (award?.mvp ? policy.projectBonus.mvpPoints : 0) +
        (award?.video ? policy.projectBonus.videoPoints : 0),
      readable: { 'project-pitch-deck': 'deck', 'project-report': 'report' },
    };
  }

  const assignment = await getAssignment(id);
  if (!assignment) throw new AppError('NOT_FOUND', 'errors.assignmentNotFound');

  const policy = await policyOfAssignment(assignment);
  return {
    id: assignment.id,
    kind: 'case_study',
    classId: assignment.classId,
    groupId: assignment.groupId,
    caseStudyId: assignment.caseStudyId,
    policy,
    rubric: policy.rubric,
    rubricVersion: assignment.rubricVersion,
    policyId: assignment.policyId,
    policyVersion: assignment.policyVersion,
    // A case study has no bonus. Returning zero rather than refusing keeps the
    // one pipeline honest: an award sent for a case study simply buys nothing.
    bonusPoints: () => 0,
    readable: { 'slides-pdf': 'slides', 'case-analysis-report': 'report' },
  };
}

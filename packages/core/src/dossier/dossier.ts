import {
  summarisePeerReviews,
  type ClassQuestion,
  type PeerReview,
  type PeerSummary,
  type PresentationPolicy,
} from '@casestudyhub/shared';
import { getAssignment } from '../assignments/assignments';
import { getCase } from '../cases/cases';
import { listGroups, listMembers } from '../groups/groups';
import { listPeerReviews } from '../peer-reviews/peer-reviews';
import { policyOfAssignment } from '../policy/policy-store';
import { findSessionForAssignment } from '../sessions/sessions';
import { listResponders, listSessionQuestions } from '../questions/questions';
import { AppError } from '../errors';

/**
 * Everything the class said and scored about one group's presentation, in one
 * place, after the fact (SRS Modules 10 and 11).
 *
 * Nothing here is new information and nothing new is stored. The questions and
 * the peer scores were always written down in full - who asked, which role
 * they asked, whether it was answered aloud, who scored what and why. What was
 * missing was anywhere to read them once the room had emptied: the live page
 * shows them while the session runs, and the marking screen showed two counts.
 *
 * A lecturer marking a group a week later, or answering a student who asks why
 * they were marked as they were, needs the detail rather than the count.
 */

export interface DossierQuestion extends ClassQuestion {
  /** The presenter the question was aimed at, when it named a role. */
  askedOfRoleId: string | null;
}

export interface DossierReview extends PeerReview {
  /** The scorer's own group, named. A group marking a rival down shows here. */
  reviewerGroupName: string | null;
}

export interface PresentationDossier {
  assignmentId: string;
  classId: string;
  groupId: string;
  groupName: string;
  caseTitle: string;
  sessionId: string | null;
  policy: PresentationPolicy;

  questions: DossierQuestion[];
  /** Questions the group answered aloud, which the Guide asks them to count. */
  answeredAloud: number;
  /** Presenters who answered nothing at all, by name. */
  presentersWhoAnsweredNothing: string[];

  reviews: DossierReview[];
  summary: PeerSummary;
  /** How many of the class who could score did. */
  eligibleScorers: number;
}

export async function presentationDossier(assignmentId: string): Promise<PresentationDossier> {
  const assignment = await getAssignment(assignmentId);
  if (!assignment) throw new AppError('NOT_FOUND', 'errors.assignmentNotFound');

  const [policy, session, groups, members, caseStudy] = await Promise.all([
    policyOfAssignment(assignment),
    findSessionForAssignment(assignmentId),
    listGroups(assignment.classId),
    listMembers(assignment.classId),
    getCase(assignment.caseStudyId),
  ]);

  const groupNameOf = (groupId: string) =>
    groups.find((group) => group.id === groupId)?.groupName ?? groupId;

  // No session means the group never presented, so there is nothing the class
  // said about it. An empty dossier is the honest answer, not an error.
  const [questions, reviews, responders] = session
    ? await Promise.all([
        listSessionQuestions(session.id),
        listPeerReviews(session.id),
        listResponders(session.id),
      ])
    : [[], [], []];

  const presenters = members.filter((member) => member.groupId === assignment.groupId);
  const answered = new Set(responders);

  return {
    assignmentId,
    classId: assignment.classId,
    groupId: assignment.groupId,
    groupName: groupNameOf(assignment.groupId),
    caseTitle: caseStudy?.title ?? assignment.caseStudyId,
    sessionId: session?.id ?? null,
    policy,

    // Never redacted for this reader: the page is behind `assertCanManageClass`,
    // and a lecturer settling a dispute about a question needs the name that
    // the class was never shown.
    questions: questions
      .map((question) => ({ ...question, askedOfRoleId: question.roleId }))
      // Most upvoted first: that is the order the room asked them in
      // spirit, and the order a lecturer rereads them in.
      .sort((a, b) => b.upvotes - a.upvotes || a.id.localeCompare(b.id)),
    answeredAloud: questions.filter((question) => question.status === 'answered').length,
    presentersWhoAnsweredNothing: presenters
      .filter((member) => !answered.has(member.studentUid))
      .map((member) => member.fullName),

    reviews: reviews
      .map((review) => ({
        ...review,
        reviewerGroupName: review.reviewerGroupId ? groupNameOf(review.reviewerGroupId) : null,
      }))
      .sort((a, b) => b.total - a.total),
    summary: summarisePeerReviews(reviews, policy.rubric),
    // Everybody in the class except the group being scored: a group cannot
    // score itself, which is the whole point of peer assessment.
    eligibleScorers: members.filter((member) => member.groupId !== assignment.groupId).length,
  };
}

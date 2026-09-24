import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  aiIsAvailable,
  assertCanManageClass,
  findSessionForAssignment,
  getAiAssessment,
  getAssignment,
  getCase,
  getLecturerAssessment,
  groupSubmittedLate,
  policyOfAssignment,
  listGroups,
  listMembers,
  listPeerReviews,
  listResponders,
  listSessionQuestions,
  qaCompletion,
} from '@casestudyhub/core';
import { summarisePeerReviews } from '@casestudyhub/shared';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { AiPanel } from './ai-panel';
import { GradeForm } from './grade-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Marking' };

/**
 * The marking screen (SRS Module 13).
 *
 * Everything the room produced is laid out beside the rubric as evidence: how
 * long each role actually spoke, whether every member answered a question, and
 * what the class scored the group. None of it is a mark. The lecturer awards
 * the points; only then does the grade engine run, on the policy version
 * frozen into the assignment when the case was set.
 */
export default async function GradePage({
  params,
}: {
  params: Promise<{ locale: string; classId: string; assignmentId: string }>;
}) {
  const { locale, classId, assignmentId } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const t = await getTranslations('grading');
  const tAi = await getTranslations('ai');
  const tError = await getTranslations('errors');

  if (user.role !== 'lecturer' && user.role !== 'admin') {
    return <Alert tone="error">{tError('forbidden')}</Alert>;
  }

  try {
    await assertCanManageClass(user, classId);
  } catch {
    return <Alert tone="error">{tError('notYourClass')}</Alert>;
  }

  const assignment = await getAssignment(assignmentId);
  if (!assignment || assignment.classId !== classId) notFound();

  // The version frozen when the case was set, so a framework published
  // since cannot change what this group is marked against.
  const policy = await policyOfAssignment(assignment);
  const aiAvailable = await aiIsAvailable();

  const [caseStudy, groups, members, assessment, isLate, session] = await Promise.all([
    getCase(assignment.caseStudyId),
    listGroups(classId),
    listMembers(classId),
    getLecturerAssessment(assignmentId),
    groupSubmittedLate(assignmentId),
    findSessionForAssignment(assignmentId),
  ]);

  const group = groups.find((candidate) => candidate.id === assignment.groupId);
  const presenters = members.filter((member) => member.groupId === assignment.groupId);

  const [questions, responders, peerReviews] = session
    ? await Promise.all([
        listSessionQuestions(session.id),
        listResponders(session.id),
        listPeerReviews(session.id),
      ])
    : [[], [], []];

  const completion = session
    ? qaCompletion(
        questions,
        presenters.map((member) => member.studentUid),
        responders,
        policy.qa.minClassQuestions,
      )
    : null;
  const peerSummary = summarisePeerReviews(peerReviews, policy.rubric);
  const aiAssessment = await getAiAssessment(assignmentId);

  // Time per role as the clock recorded it. Deliberately the banked figure and
  // not a live one: marking is done after the presentation, and a number that
  // ticked while the lecturer typed would not be the time anyone spoke.
  const roleMinutes = session
    ? Object.fromEntries(
        policy.roles.map((role) => [role.id, (session.roleMs[role.id] ?? 0) / 60000]),
      )
    : null;
  const clockStillRunning = session?.runningSinceMs !== null && session !== null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-muted mt-2 text-sm">
            {group?.groupName ?? assignment.groupId} · {caseStudy?.title ?? assignment.caseStudyId}
          </p>
        </div>
        <Badge tone={assessment?.status === 'published' ? 'brand' : 'neutral'}>
          {t(`status.${assessment?.status ?? 'unmarked'}`)}
        </Badge>
      </div>

      <Card>
        <CardTitle>{t('evidenceTitle')}</CardTitle>
        <p className="text-muted mt-2 text-sm">{t('evidenceHint')}</p>

        <ul className="mt-4 space-y-2 text-sm">
          <li>
            {isLate
              ? t('evidenceLate', { points: policy.grading.lateSubmissionPenaltyPoints })
              : t('evidenceOnTime')}
          </li>
          {completion ? (
            <>
              <li>
                {t('evidenceQuestions', {
                  count: completion.classQuestions,
                  answered: completion.answered,
                })}
              </li>
              <li>
                {completion.everyMemberAnswered
                  ? t('evidenceEveryMemberAnswered')
                  : t('evidenceMembersSilent', {
                      names: completion.membersWithoutAnswer
                        .map(
                          (uid) =>
                            presenters.find((member) => member.studentUid === uid)?.fullName ?? uid,
                        )
                        .join(', '),
                    })}
              </li>
            </>
          ) : (
            <li className="text-muted">{t('evidenceNoSession')}</li>
          )}
          <li>
            {peerSummary.count === 0
              ? t('evidenceNoPeerScores')
              : t('evidencePeerScores', {
                  count: peerSummary.count,
                  mean: peerSummary.mean.toFixed(1),
                  median: peerSummary.median.toFixed(1),
                })}
          </li>
        </ul>

        {clockStillRunning ? (
          <p className="text-muted mt-3 text-sm">{t('clockStillRunning')}</p>
        ) : null}

        {roleMinutes ? (
          <ul className="mt-4 flex flex-wrap gap-2 text-xs">
            {policy.roles.map((role) => (
              <li key={role.id} className="surface-card rounded-full px-3 py-1 tabular-nums">
                {role.id} {(roleMinutes[role.id] ?? 0).toFixed(1)}′ / {role.minutes}′
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card>
        <CardTitle>{tAi('title')}</CardTitle>
        <div className="mt-4">
          <AiPanel assignmentId={assignmentId} available={aiAvailable} initial={aiAssessment} />
        </div>
      </Card>

      <Card>
        <CardTitle>{t('markTitle')}</CardTitle>
        <div className="mt-4">
          <GradeForm
            assignmentId={assignmentId}
            members={presenters.map((member) => ({
              studentUid: member.studentUid,
              studentId: member.studentId,
              fullName: member.fullName,
              roleIds: member.roleIds,
            }))}
            assessment={assessment}
            policy={policy}
            isLate={isLate}
            canPublish={user.role === 'lecturer'}
          />
        </div>
      </Card>
    </div>
  );
}

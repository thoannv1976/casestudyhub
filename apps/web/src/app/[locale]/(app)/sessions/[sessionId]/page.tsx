import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  CLASS_VISIBLE_DELIVERABLE_ID,
  assertCanViewClass,
  currentVersions,
  findMembership,
  getAssignment,
  getCase,
  getClassById,
  getOwnPeerReview,
  getSession,
  listGroups,
  listMembers,
  listPeerReviews,
  listResponders,
  listSessionQuestions,
  listSubmissions,
  qaCompletion,
  policyOfAssignment,
  policyOfClass,
  votesOf,
} from '@casestudyhub/core';
import { redactForViewer, roleKeyOf, summarisePeerReviews } from '@casestudyhub/shared';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { SessionRoom } from './session-room';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}): Promise<Metadata> {
  const { sessionId } = await params;
  const session = await getSession(sessionId);
  if (!session) return { title: 'Session' };
  const caseStudy = await getCase(session.caseStudyId);
  return { title: caseStudy?.title ?? 'Session' };
}

/**
 * The room, as everyone in it sees it.
 *
 * One page serves three audiences at once: the lecturer running the clock,
 * the group presenting, and the rest of the class watching and asking. What
 * differs between them is which controls are rendered, never which data is
 * fetched behind their back - every read here has already passed
 * `assertCanViewClass`.
 */
export default async function SessionPage({
  params,
}: {
  params: Promise<{ locale: string; sessionId: string }>;
}) {
  const { locale, sessionId } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const t = await getTranslations('session');
  const tPeer = await getTranslations('peerReview');
  const tRubric = await getTranslations('rubric');
  const tRoles = await getTranslations('roles');
  const tError = await getTranslations('errors');

  const session = await getSession(sessionId);
  if (!session) notFound();

  try {
    await assertCanViewClass(user, session.classId);
  } catch {
    return <Alert tone="error">{tError('notInThisClass')}</Alert>;
  }

  const isStaff = user.role === 'admin' || user.role === 'lecturer';

  const [details, assignment, caseStudy, groups, members, membership, questions, myVotes] =
    await Promise.all([
      getClassById(session.classId),
      getAssignment(session.assignmentId),
      getCase(session.caseStudyId),
      listGroups(session.classId),
      listMembers(session.classId),
      findMembership(session.classId, user.uid),
      listSessionQuestions(sessionId),
      votesOf(user.uid, sessionId),
    ]);

  // Everything in the room reads from one framework: the clock's limits, the
  // rubric the class scores against, the Q&A checklist. It is the version the
  // assignment froze, so opening an old session still shows its own rules.
  const policy = assignment
    ? await policyOfAssignment(assignment)
    : await policyOfClass(session.classId);

  const group = groups.find((candidate) => candidate.id === session.groupId);
  const presenters = members.filter((member) => member.groupId === session.groupId);
  const isPresenter = membership?.groupId === session.groupId;

  // The slide deck is the one thing the rest of the class may open, and only
  // once the session has started (see `classMayViewSubmission`).
  const submissions = assignment ? currentVersions(await listSubmissions(assignment.id)) : [];
  const slides = submissions.find(
    (submission) => submission.deliverableId === CLASS_VISIBLE_DELIVERABLE_ID,
  );

  // A student reads back only their own score; the distribution is the
  // lecturer's to read. Peers scoring each other's scores would be a spiral.
  const ownReview = await getOwnPeerReview(sessionId, user.uid);
  const peerReviews = isStaff ? await listPeerReviews(sessionId) : [];
  const peerSummary = isStaff ? summarisePeerReviews(peerReviews, policy.rubric) : null;

  // The Q&A checklist of the Guide is the lecturer's, not the class's: it
  // names members who have not yet answered anything.
  const completion = isStaff
    ? qaCompletion(
        questions,
        presenters.map((member) => member.studentUid),
        await listResponders(sessionId),
        policy.qa.minClassQuestions,
      )
    : null;

  return (
    <div className="space-y-8">
      <Card>
        <CardTitle>{t('presenters')}</CardTitle>
        <ul className="mt-4 space-y-2">
          {presenters.length === 0 ? (
            <li className="text-muted text-sm">{t('noPresenters')}</li>
          ) : (
            presenters.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{member.fullName}</span>
                <span className="text-muted font-mono text-xs">{member.studentId}</span>
                {member.roleIds.map((roleId) => (
                  <Badge key={roleId} tone="accent">
                    {roleId} · {tRoles(`${roleKeyOf(roleId)}.title`)}
                  </Badge>
                ))}
              </li>
            ))
          )}
        </ul>
      </Card>

      <Card>
        <CardTitle>{t('slides')}</CardTitle>
        {slides ? (
          <p className="mt-3 text-sm">
            <a
              className="text-brand-600 dark:text-brand-300 font-medium underline"
              href={`/api/submissions/${slides.id}/file`}
              target="_blank"
              rel="noreferrer"
            >
              {slides.fileName}
            </a>
            <span className="text-muted ml-2 text-xs">
              {t('version', { number: slides.versionNumber })}
            </span>
          </p>
        ) : (
          <p className="text-muted mt-3 text-sm">{t('noSlides')}</p>
        )}
      </Card>

      {completion ? (
        <Card>
          <CardTitle>{t('qaChecklist')}</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              {completion.enoughClassQuestions ? '✓' : '·'}{' '}
              {t('qaQuestions', {
                count: completion.classQuestions,
                min: policy.qa.minClassQuestions,
              })}
            </li>
            <li>
              {completion.everyMemberAnswered ? '✓' : '·'}{' '}
              {t('qaMembers', {
                answered: completion.membersAnswered.length,
                total: presenters.length,
              })}
            </li>
            {completion.membersWithoutAnswer.length > 0 ? (
              <li className="text-muted">
                {t('qaWaiting', {
                  names: completion.membersWithoutAnswer
                    .map(
                      (uid) =>
                        presenters.find((member) => member.studentUid === uid)?.fullName ?? uid,
                    )
                    .join(', '),
                })}
              </li>
            ) : null}
          </ul>
        </Card>
      ) : null}

      {peerSummary ? (
        <Card>
          <CardTitle>{tPeer('summaryTitle')}</CardTitle>
          <p className="text-muted mt-2 text-sm">{tPeer('evidenceOnly')}</p>
          {peerSummary.count === 0 ? (
            <p className="text-muted mt-4 text-sm">{tPeer('noScores')}</p>
          ) : (
            <>
              <p className="mt-4 text-sm">
                {tPeer('overall', {
                  count: peerSummary.count,
                  mean: peerSummary.mean.toFixed(1),
                  median: peerSummary.median.toFixed(1),
                  lowest: peerSummary.lowest,
                  highest: peerSummary.highest,
                })}
              </p>
              <ul className="mt-3 space-y-1 text-sm">
                {policy.rubric.criteria.map((criterion) => {
                  const row = peerSummary.byCriterion[criterion.id];
                  return (
                    <li key={criterion.id} className="flex flex-wrap justify-between gap-2">
                      <span>{tRubric(criterion.key.replace(/^rubric\./, ''))}</span>
                      <span className="tabular-nums">
                        {(row?.mean ?? 0).toFixed(1)} / {criterion.maxPoints}
                        <span className="text-muted ml-2 text-xs">
                          {tPeer('range', { lowest: row?.lowest ?? 0, highest: row?.highest ?? 0 })}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
      ) : null}

      <SessionRoom
        sessionId={sessionId}
        policy={policy}
        ownUid={user.uid}
        isStaff={isStaff}
        isStudent={user.role === 'student'}
        title={caseStudy?.title ?? session.caseStudyId}
        subtitle={`${group?.groupName ?? session.groupId}${details ? ` · ${details.className}` : ''}`}
        initial={{
          session,
          questions: questions.map((question) =>
            redactForViewer(question, { uid: user.uid, isStaff }),
          ),
          myVotes,
          ownReview,
          isPresenter,
        }}
      />
    </div>
  );
}

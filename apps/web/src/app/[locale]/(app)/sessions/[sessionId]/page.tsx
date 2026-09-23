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
  getSession,
  listGroups,
  listMembers,
  listResponders,
  listSessionQuestions,
  listSubmissions,
  qaCompletion,
  votesOf,
} from '@casestudyhub/core';
import { DEFAULT_PRESENTATION_POLICY, redactForViewer, roleKeyOf } from '@casestudyhub/shared';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { SessionTimer } from './session-timer';
import { QuestionWall } from './question-wall';

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
  const tQuestions = await getTranslations('questions');
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

  const group = groups.find((candidate) => candidate.id === session.groupId);
  const presenters = members.filter((member) => member.groupId === session.groupId);
  const isPresenter = membership?.groupId === session.groupId;

  // The slide deck is the one thing the rest of the class may open, and only
  // once the session has started (see `classMayViewSubmission`).
  const submissions = assignment ? currentVersions(await listSubmissions(assignment.id)) : [];
  const slides = submissions.find(
    (submission) => submission.deliverableId === CLASS_VISIBLE_DELIVERABLE_ID,
  );

  // The Q&A checklist of the Guide is the lecturer's, not the class's: it
  // names members who have not yet answered anything.
  const completion = isStaff
    ? qaCompletion(
        questions,
        presenters.map((member) => member.studentUid),
        await listResponders(sessionId),
        DEFAULT_PRESENTATION_POLICY.qa.minClassQuestions,
      )
    : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {caseStudy?.title ?? session.caseStudyId}
          </h1>
          <p className="text-muted mt-2 text-sm">
            {group?.groupName ?? session.groupId}
            {details ? ` · ${details.className}` : ''}
          </p>
        </div>
        <Badge tone={session.status === 'completed' ? 'neutral' : 'brand'}>
          {t(`status.${session.status}`)}
        </Badge>
      </div>

      <Card>
        <CardTitle>{t('timerTitle')}</CardTitle>
        <div className="mt-4">
          <SessionTimer session={session} canControl={isStaff} />
        </div>
      </Card>

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
                min: DEFAULT_PRESENTATION_POLICY.qa.minClassQuestions,
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

      <Card>
        <CardTitle>{tQuestions('title')}</CardTitle>
        <p className="text-muted mt-2 text-sm">{tQuestions('purpose')}</p>
        <div className="mt-4">
          <QuestionWall
            sessionId={sessionId}
            initialQuestions={questions.map((question) =>
              redactForViewer(question, { uid: user.uid, isStaff }),
            )}
            initialVotes={myVotes}
            ownUid={user.uid}
            isStaff={isStaff}
            isPresenter={isPresenter}
            canAsk={user.role === 'student' && !isPresenter}
            questionsOpen={session.questionsOpen}
          />
        </div>
      </Card>
    </div>
  );
}

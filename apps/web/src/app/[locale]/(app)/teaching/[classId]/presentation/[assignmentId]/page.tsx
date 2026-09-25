import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { assertCanManageClass, presentationDossier } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { Link } from '@/i18n/navigation';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dossier' });
  return { title: t('title') };
}

/**
 * Everything the class said and scored about one group's presentation.
 *
 * Nothing on this page is new information. The questions and the peer scores
 * were always written down in full; what was missing was anywhere to read them
 * once the room had emptied - the live page shows them while the session runs,
 * and the marking screen showed two counts.
 *
 * Names are not hidden here, including on anonymous questions. The page is
 * behind `assertCanManageClass`, and a lecturer answering "why was I marked
 * like this" needs the detail the class was never shown.
 */
export default async function DossierPage({
  params,
}: {
  params: Promise<{ locale: string; classId: string; assignmentId: string }>;
}) {
  const { locale, classId, assignmentId } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const t = await getTranslations('dossier');
  const tQuestions = await getTranslations('questions');
  const tRubric = await getTranslations('rubric');
  const tError = await getTranslations('errors');

  try {
    await assertCanManageClass(user, classId);
  } catch {
    return <Alert tone="error">{tError('notYourClass')}</Alert>;
  }

  const dossier = await presentationDossier(assignmentId).catch(() => null);
  if (!dossier || dossier.classId !== classId) notFound();

  const percent = (value: number) => `${Math.round(value * 100)}%`;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{dossier.caseTitle}</h1>
          <p className="text-muted mt-2 text-sm">
            {dossier.groupName}
            {dossier.sessionId ? null : ` · ${t('neverPresented')}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/teaching/${classId}/grade/${assignmentId}`}
            className="text-brand-600 dark:text-brand-300 text-sm font-medium underline"
          >
            {t('backToMarking')}
          </Link>
          <a
            href={`/api/assignments/${assignmentId}/dossier`}
            className="text-brand-600 dark:text-brand-300 text-sm font-medium underline"
          >
            {t('download')}
          </a>
        </div>
      </div>

      <Card>
        <CardTitle>{t('questionsTitle')}</CardTitle>
        <p className="text-muted mt-2 text-sm">
          {t('questionsCount', {
            total: dossier.questions.length,
            answered: dossier.answeredAloud,
            min: dossier.policy.qa.minClassQuestions,
          })}
        </p>
        {dossier.presentersWhoAnsweredNothing.length > 0 ? (
          <p className="text-muted mt-1 text-sm">
            {t('answeredNothing', { names: dossier.presentersWhoAnsweredNothing.join(', ') })}
          </p>
        ) : null}

        {dossier.questions.length === 0 ? (
          <p className="text-muted mt-4 text-sm">{t('noQuestions')}</p>
        ) : (
          <ul className="mt-4 space-y-4" data-testid="dossier-questions">
            {dossier.questions.map((question) => (
              <li key={question.id} className="border-b border-[var(--border-subtle)] pb-4">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone={question.status === 'answered' ? 'brand' : 'neutral'}>
                    {question.status === 'answered' ? t('answered') : t('notAnswered')}
                  </Badge>
                  <span className="text-muted">
                    {tQuestions(`categories.${question.category}`)}
                  </span>
                  {question.askedOfRoleId ? (
                    <span className="text-muted">
                      {t('askedOf', { role: question.askedOfRoleId })}
                    </span>
                  ) : null}
                  <span className="text-muted">{t('upvotes', { count: question.upvotes })}</span>
                  <span className="text-muted ml-auto">
                    {/* The name, even on an anonymous question: the class never
                        saw it, the lecturer always could. */}
                    {question.askedByName}
                    <span className="ml-2 font-mono">{question.askedByStudentId}</span>
                    {question.anonymousToClass ? ` · ${t('anonymousToClass')}` : ''}
                  </span>
                </div>
                <p className="mt-2 text-sm">{question.text}</p>
                {question.answerText ? (
                  <p className="text-muted mt-2 border-l-2 border-[var(--border-subtle)] pl-3 text-sm">
                    {question.answerText}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>{t('scoresTitle')}</CardTitle>
        <p className="text-muted mt-2 text-sm">{t('scoresEvidence')}</p>
        <p className="mt-3 text-sm">
          {t('scoresCount', {
            count: dossier.summary.count,
            eligible: dossier.eligibleScorers,
          })}
        </p>

        {dossier.summary.count === 0 ? (
          <p className="text-muted mt-4 text-sm">{t('noScores')}</p>
        ) : (
          <>
            <p className="mt-3 text-sm">
              {t('meanAndMedian', {
                mean: dossier.summary.mean.toFixed(1),
                median: dossier.summary.median.toFixed(1),
                lowest: dossier.summary.lowest,
                highest: dossier.summary.highest,
              })}
            </p>

            <ul className="mt-4 space-y-1 text-sm">
              {dossier.policy.rubric.criteria.map((criterion) => {
                const row = dossier.summary.byCriterion[criterion.id];
                return (
                  <li key={criterion.id} className="flex flex-wrap justify-between gap-2">
                    <span>{tRubric(criterion.key.replace(/^rubric\./, ''))}</span>
                    <span className="tabular-nums">
                      {(row?.mean ?? 0).toFixed(1)} / {criterion.maxPoints}
                      <span className="text-muted ml-2 text-xs">
                        {t('range', { lowest: row?.lowest ?? 0, highest: row?.highest ?? 0 })}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>

            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)]">
                    <th scope="col" className="px-3 py-2 font-semibold">
                      {t('scorer')}
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      {t('scorerGroup')}
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      {t('total')}
                    </th>
                    <th scope="col" className="px-3 py-2 font-semibold">
                      {t('comment')}
                    </th>
                  </tr>
                </thead>
                <tbody data-testid="dossier-scores">
                  {dossier.reviews.map((review) => (
                    <tr key={review.id} className="border-b border-[var(--border-subtle)]">
                      <td className="px-3 py-2">
                        {review.reviewerName}
                        <span className="text-muted ml-2 font-mono text-xs">
                          {review.reviewerStudentId}
                        </span>
                      </td>
                      {/* Named, because a group marking a rival down shows here
                          and nowhere else. */}
                      <td className="px-3 py-2">{review.reviewerGroupName ?? '—'}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {review.total} / {dossier.policy.rubric.totalPoints}
                        <span className="text-muted ml-2 text-xs">
                          {percent(review.total / dossier.policy.rubric.totalPoints)}
                        </span>
                      </td>
                      <td className="text-muted px-3 py-2">{review.comment ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { aiIsAvailable, assertCanReadCase, getCase, listCaseQuestions } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { AnswerBank } from './answer-bank';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ caseId: string }>;
}): Promise<Metadata> {
  const { caseId } = await params;
  const caseStudy = await getCase(caseId);
  return { title: caseStudy?.title ?? 'Case study' };
}

/**
 * The knowledge base a case accumulates (SRS Module 12.5).
 *
 * Every question every class ever asked about this case, with the answers -
 * the two or three the group gave in the room, and the rest answered against
 * the case material afterwards. A student from a later cohort reads it with
 * the askers' names removed: the questions are the material, the names are
 * not.
 */
export default async function CaseKnowledgePage({
  params,
}: {
  params: Promise<{ locale: string; caseId: string }>;
}) {
  const { locale, caseId } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const t = await getTranslations('caseBank');
  const tQuestions = await getTranslations('questions');
  const tError = await getTranslations('errors');

  const caseStudy = await getCase(caseId);
  if (!caseStudy) notFound();

  try {
    await assertCanReadCase(user, caseStudy);
  } catch {
    return <Alert tone="error">{tError('forbidden')}</Alert>;
  }

  const isStaff = user.role === 'admin' || user.role === 'lecturer';
  // A later cohort reads the bank anonymised; the lecturer of the class that
  // asked still sees who asked, because it counts toward the individual mark.
  const questions = await listCaseQuestions(caseId, { forOtherCohort: !isStaff });

  const answered = questions.filter((question) => question.answerText);
  const byRoom = answered.filter((question) => !question.answeredByAi);
  const unanswered = questions.length - answered.length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{caseStudy.title}</h1>
        <p className="text-muted mt-2 font-mono text-sm">{caseStudy.caseCode}</p>
      </div>

      <Card>
        <CardTitle>{t('title')}</CardTitle>
        <p className="text-muted mt-2 text-sm">{t('purpose')}</p>
        <p className="mt-3 text-sm">
          {t('counts', {
            total: questions.length,
            inRoom: byRoom.length,
            open: unanswered,
          })}
        </p>

        {isStaff ? (
          <div className="mt-4">
            <AnswerBank caseId={caseId} available={aiIsAvailable()} pending={unanswered} />
          </div>
        ) : null}
      </Card>

      <ul className="space-y-3">
        {questions.length === 0 ? (
          <li className="text-muted text-sm">{t('empty')}</li>
        ) : (
          questions.map((question) => (
            <li key={question.id} className="surface-card rounded-xl p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{tQuestions(`categories.${question.category}`)}</Badge>
                {question.answeredByAi ? <Badge tone="accent">{t('answeredByAi')}</Badge> : null}
                {question.answerText && !question.answeredByAi ? (
                  <Badge tone="brand">{t('answeredInRoom')}</Badge>
                ) : null}
                {question.aiGroundedInCase === false ? <Badge>{t('notInTheCase')}</Badge> : null}
                <span className="text-muted text-xs tabular-nums">▲ {question.upvotes}</span>
              </div>

              <p className="mt-3 text-sm font-medium">{question.text}</p>

              {question.answerText ? (
                <p className="border-brand-300 mt-3 border-l-2 pl-3 text-sm">
                  {question.answerText}
                </p>
              ) : (
                <p className="text-muted mt-3 text-sm">{t('notYetAnswered')}</p>
              )}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

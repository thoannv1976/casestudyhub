import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  aiIsAvailable,
  assertCanReadCase,
  getCase,
  getTutorSession,
  listCaseQuestions,
  listCaseVersions,
} from '@casestudyhub/core';
import { officialAnswer } from '@casestudyhub/shared';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { AnswerBank } from './answer-bank';
import { CaseEditor } from './case-editor';
import { SuggestedQuestions } from './suggested-questions';
import { Tutor } from './tutor';

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
  const tTutor = await getTranslations('tutor');
  const tSuggestions = await getTranslations('suggestions');
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
  const versions = isStaff ? await listCaseVersions(caseId) : [];

  const aiAvailable = await aiIsAvailable();
  // A tutor conversation belongs to one student, and is loaded for them only.
  const tutorSession = isStaff ? null : await getTutorSession(caseId, user.uid);

  // What a reader is given: the lecturer's settled answer, else the group's.
  // An AI suggestion nobody settled is not an answer, and students never get it.
  const answered = questions.filter((question) => officialAnswer(question));
  // Answered aloud by the group, whether or not the lecturer settled it since.
  const byRoom = questions.filter(
    (question) => question.answerText && !question.answeredByAi && question.answerChannel !== 'app',
  );
  const unanswered = questions.length - answered.length;
  const awaitingSuggestion = questions.filter(
    (question) => !question.finalAnswer && !question.aiSuggestion,
  ).length;

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
            <AnswerBank caseId={caseId} available={aiAvailable} pending={awaitingSuggestion} />
          </div>
        ) : null}
      </Card>

      {isStaff ? <CaseEditor caseStudy={caseStudy} versions={versions} /> : null}

      {isStaff ? (
        <Card>
          <CardTitle>{tSuggestions('title')}</CardTitle>
          <div className="mt-4">
            <SuggestedQuestions caseId={caseId} available={aiAvailable} />
          </div>
        </Card>
      ) : (
        <Card>
          <CardTitle>{tTutor('title')}</CardTitle>
          <p className="text-muted mt-2 text-sm">{tTutor('purpose')}</p>
          <div className="mt-4">
            <Tutor caseId={caseId} available={aiAvailable} initial={tutorSession} />
          </div>
        </Card>
      )}

      <ul className="space-y-3">
        {questions.length === 0 ? (
          <li className="text-muted text-sm">{t('empty')}</li>
        ) : (
          questions.map((question) => {
            const answer = officialAnswer(question);
            return (
              <li key={question.id} className="surface-card rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{tQuestions(`categories.${question.category}`)}</Badge>
                  {answer?.source === 'final' ? <Badge tone="brand">{t('settled')}</Badge> : null}
                  {answer?.source === 'ai' ? (
                    <Badge tone="accent">{t('answeredByAi')}</Badge>
                  ) : null}
                  {answer?.source === 'group' ? (
                    <Badge tone="brand">
                      {answer.channel === 'app' ? t('answeredInApp') : t('answeredInRoom')}
                    </Badge>
                  ) : null}
                  {question.featuredQuestion ? (
                    <Badge tone="accent">{tQuestions('featuredQuestion')}</Badge>
                  ) : null}
                  {question.featuredAnswer ? (
                    <Badge tone="accent">{tQuestions('featuredAnswer')}</Badge>
                  ) : null}
                  {question.aiGroundedInCase === false ? <Badge>{t('notInTheCase')}</Badge> : null}
                  <span className="text-muted text-xs tabular-nums">▲ {question.upvotes}</span>
                </div>

                <p className="mt-3 text-sm font-medium">{question.text}</p>

                {answer ? (
                  <p className="border-brand-300 mt-3 border-l-2 pl-3 text-sm">{answer.text}</p>
                ) : (
                  <p className="text-muted mt-3 text-sm">{t('notYetAnswered')}</p>
                )}
                {answer?.source === 'final' &&
                question.answerText &&
                !question.answeredByAi &&
                question.answerText !== answer.text ? (
                  <p className="text-muted mt-2 text-xs">
                    {t('groupSaid')}: {question.answerText}
                  </p>
                ) : null}

                {isStaff && question.aiSuggestion && !question.finalAnswer ? (
                  <div className="mt-3 rounded-lg border border-dashed border-[var(--border-subtle)] p-3 text-sm">
                    <p className="text-muted text-xs">
                      {t('suggestionLabel', { model: question.aiSuggestion.model })}
                      {question.aiSuggestion.groundedInCase ? '' : ` · ${t('notInTheCase')}`}
                    </p>
                    <p className="mt-1">{question.aiSuggestion.text}</p>
                  </div>
                ) : null}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

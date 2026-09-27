'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ClassQuestion, QuestionClusterSet } from '@casestudyhub/shared';
import type { SessionAskers } from '@casestudyhub/core';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button } from '@/components/ui/form';
import { Badge } from '@/components/ui/card';

/**
 * A presentation's whole question wall, for the lecturer.
 *
 * Three things a lecturer wants from it, in the order they want them: who still
 * owes a question while the room is still in front of them, what the questions
 * actually are, and a way through sixty of them in ten minutes.
 *
 * The model can answer the ones the room never got to, and group them into
 * themes. Neither changes a question's status: an answer given aloud by a
 * student is never overwritten by one written by a machine.
 */
export function QuestionBoard({
  sessionId,
  questions,
  askers,
  clusters,
  aiAvailable,
}: {
  sessionId: string;
  questions: ClassQuestion[];
  askers: SessionAskers;
  clusters: QuestionClusterSet | null;
  aiAvailable: boolean;
}) {
  const t = useTranslations('questionBoard');
  const tAi = useTranslations('ai');
  const tCategory = useTranslations('questions.categories');
  const tError = useTranslations();
  const router = useRouter();

  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<'answer' | 'cluster' | null>(null);

  async function run(action: 'answer' | 'cluster') {
    setBusy(action);
    setErrorKey(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/questions-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json().catch(() => null)) as {
        result?: { answered: number; ungrounded: number };
        error?: { messageKey?: string };
      } | null;

      if (!response.ok) {
        setErrorKey(payload?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      setNotice(
        action === 'answer'
          ? t('answered', {
              count: payload?.result?.answered ?? 0,
              ungrounded: payload?.result?.ungrounded ?? 0,
            })
          : t('clustered'),
      );
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const byId = new Map(questions.map((question) => [question.id, question]));

  return (
    <div className="space-y-6">
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <section className="space-y-3" data-testid="asker-tally">
        <h2 className="text-sm font-semibold">{t('askersTitle')}</h2>
        <p className="text-sm">
          {t('askersCount', { asked: askers.asked, expected: askers.expected })}
        </p>
        {askers.missing === 0 ? (
          <p className="text-muted text-sm">{t('everyoneAsked')}</p>
        ) : (
          <>
            {/* The names, not only the count: four missing is a number, and
                four names are something a lecturer can read out. */}
            <p className="text-muted text-sm">{t('stillOwing')}</p>
            <ul className="flex flex-wrap gap-2 text-sm">
              {askers.rows
                .filter((row) => !row.asked)
                .map((row) => (
                  <li key={row.studentUid} className="surface-card rounded-full px-3 py-1">
                    <span className="font-mono text-xs">{row.studentId}</span> {row.fullName}
                  </li>
                ))}
            </ul>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{tAi('title')}</h2>
        {aiAvailable ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void run('cluster')} disabled={busy !== null}>
              {busy === 'cluster' ? tAi('reading') : t('cluster')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void run('answer')}
              disabled={busy !== null || questions.length === 0}
            >
              {busy === 'answer' ? tAi('reading') : t('answerPending')}
            </Button>
          </div>
        ) : (
          <p className="text-muted text-sm">{tAi('notConfigured')}</p>
        )}
        <p className="text-muted text-xs">{tAi('advisory')}</p>

        {clusters ? (
          <div className="space-y-3" data-testid="question-clusters">
            <p className="text-muted text-xs">
              {t('clusteredBy', {
                model: clusters.model,
                when: clusters.createdAt.slice(0, 16).replace('T', ' '),
              })}
            </p>
            {clusters.clusters.map((cluster) => (
              <div key={cluster.title} className="surface-card rounded-xl p-4">
                {/* Written by the model, in the language the questions were
                    asked in: content, like the questions themselves. */}
                <h3 className="text-sm font-semibold">{cluster.title}</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {cluster.questionIds.map((id) => (
                    <li key={id}>{byId.get(id)?.text ?? id}</li>
                  ))}
                </ul>
              </div>
            ))}
            {clusters.unclustered.length > 0 ? (
              <p className="text-muted text-xs">
                {t('unclustered', { count: clusters.unclustered.length })}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t('allTitle')}</h2>
        {questions.length === 0 ? (
          <p className="text-muted text-sm">{t('none')}</p>
        ) : (
          <ul className="space-y-3">
            {questions.map((question) => (
              <li key={question.id} className="surface-card rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{tCategory(question.category)}</Badge>
                  {/* Staff see who asked, whatever the class sees. */}
                  <span className="text-muted text-xs">
                    <span className="font-mono">{question.askedByStudentId}</span>{' '}
                    {question.askedByName}
                  </span>
                  {question.upvotes > 0 ? (
                    <span className="text-muted text-xs">
                      {t('upvotes', { count: question.upvotes })}
                    </span>
                  ) : null}
                  {question.status === 'answered' ? <Badge>{t('answeredAloud')}</Badge> : null}
                </div>
                <p className="mt-2 text-sm">{question.text}</p>
                {question.answerText ? (
                  <div className="mt-3 border-l-2 border-[var(--border-subtle)] pl-3">
                    <p className="text-sm">{question.answerText}</p>
                    <p className="text-muted mt-1 text-xs">
                      {question.answeredByAi
                        ? t('answeredByModel', { model: question.answeredByName ?? '' })
                        : t('answeredByStudent', { name: question.answeredByName ?? '' })}
                      {question.answeredByAi && question.aiGroundedInCase === false
                        ? ` · ${t('notInSources')}`
                        : ''}
                    </p>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

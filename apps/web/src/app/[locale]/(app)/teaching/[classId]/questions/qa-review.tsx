'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { AfterClassQa, AiProviderName, ClassQuestion } from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Badge, Card } from '@/components/ui/card';
import { Alert, Button, Field, Input, Select, Textarea } from '@/components/ui/form';

export interface QaSessionView {
  id: string;
  groupName: string;
  /** The case presented; empty for the class group project. */
  subject: string;
  status: string;
  startedAt: string | null;
  questions: ClassQuestion[];
}

type Filter = 'all' | 'unsettled' | 'featured';

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; payload: unknown }> {
  const response = await fetch(url, {
    method: url.endsWith('/qa-settings') ? 'PUT' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, payload: await response.json().catch(() => null) };
}

function errorKeyOf(payload: unknown): string {
  return (
    (payload as { error?: { messageKey?: string } } | null)?.error?.messageKey ??
    'errors.unexpected'
  );
}

/**
 * The lecturer's Q&A desk for one class.
 *
 * For every question: what the group answered (aloud or in the app), what the
 * model suggests, and a box to settle the answer the class keeps. A settled
 * answer is what students and later cohorts read; a suggestion never reaches
 * them on its own.
 */
export function QaReview({
  classId,
  locale,
  sessions,
  afterClassQa,
  liveQaUrl,
  providers,
  defaultProvider,
}: {
  classId: string;
  locale: string;
  sessions: QaSessionView[];
  afterClassQa: AfterClassQa;
  /** In-class Q&A held in ClassInteract, if the lecturer set it. */
  liveQaUrl: string | null;
  /** Vendors with a key, which the lecturer may pick for suggestions. */
  providers: AiProviderName[];
  defaultProvider: AiProviderName | null;
}) {
  const t = useTranslations('qaReview');
  const tSystem = useTranslations('systemAdmin');
  const tError = useTranslations();
  const router = useRouter();

  const [filter, setFilter] = useState<Filter>('all');
  const [provider, setProvider] = useState<AiProviderName | null>(defaultProvider);
  const [busy, setBusy] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const all = sessions.flatMap((session) => session.questions);
  const settled = all.filter((question) => question.finalAnswer).length;
  const featured = all.filter((question) => question.featuredQuestion || question.featuredAnswer);

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy('settings');
    setErrorKey(null);
    setNotice(null);
    try {
      const { ok, payload } = await postJson(`/api/classes/${classId}/qa-settings`, {
        afterClassQa: {
          askDays: Number(form.get('askDays') ?? 0),
          answerDays: Number(form.get('answerDays') ?? 0),
        },
        liveQaUrl: String(form.get('liveQaUrl') ?? '').trim(),
      });
      if (!ok) {
        setErrorKey(errorKeyOf(payload));
        return;
      }
      setNotice(t('settingsSaved'));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function suggest(sessionId: string) {
    setBusy(`suggest-${sessionId}`);
    setErrorKey(null);
    setNotice(null);
    try {
      const { ok, payload } = await postJson(`/api/sessions/${sessionId}/questions-ai`, {
        action: 'answer',
        provider,
      });
      if (!ok) {
        setErrorKey(errorKeyOf(payload));
        return;
      }
      const result = (payload as { result?: { answered?: number; ungrounded?: number } }).result;
      setNotice(
        t('suggested', { count: result?.answered ?? 0, ungrounded: result?.ungrounded ?? 0 }),
      );
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const visible = (question: ClassQuestion) =>
    filter === 'all'
      ? true
      : filter === 'unsettled'
        ? !question.finalAnswer
        : question.featuredQuestion || question.featuredAnswer;

  return (
    <div className="space-y-6" data-testid="qa-review">
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <h2 className="font-semibold">{t('settingsTitle')}</h2>
        <p className="text-muted mt-1 text-sm">{t('settingsHint')}</p>
        <form onSubmit={saveSettings} className="mt-4 flex flex-wrap items-end gap-4">
          <Field label={t('askDays')} htmlFor="askDays" hint={t('askDaysHint')}>
            <Input
              id="askDays"
              name="askDays"
              type="number"
              min={0}
              max={14}
              defaultValue={afterClassQa.askDays}
              className="w-24"
            />
          </Field>
          <Field label={t('answerDays')} htmlFor="answerDays" hint={t('answerDaysHint')}>
            <Input
              id="answerDays"
              name="answerDays"
              type="number"
              min={0}
              max={30}
              defaultValue={afterClassQa.answerDays}
              className="w-24"
            />
          </Field>
          <Field label={t('liveQaUrl')} htmlFor="liveQaUrl" hint={t('liveQaUrlHint')}>
            <Input
              id="liveQaUrl"
              name="liveQaUrl"
              type="url"
              placeholder="https://classinteractive.web.app/…"
              defaultValue={liveQaUrl ?? ''}
              className="w-96 max-w-full"
            />
          </Field>
          <Button type="submit" disabled={busy !== null}>
            {t('saveSettings')}
          </Button>
        </form>
      </Card>

      <div className="flex flex-wrap items-end gap-4">
        <Field label={t('filter')} htmlFor="qaFilter">
          <Select
            id="qaFilter"
            value={filter}
            onChange={(event) => setFilter(event.target.value as Filter)}
          >
            <option value="all">{t('filterAll')}</option>
            <option value="unsettled">{t('filterUnsettled')}</option>
            <option value="featured">{t('filterFeatured')}</option>
          </Select>
        </Field>
        {providers.length > 0 ? (
          <Field label={t('provider')} htmlFor="qaProvider" hint={t('providerHint')}>
            <Select
              id="qaProvider"
              value={provider ?? ''}
              onChange={(event) => setProvider(event.target.value as AiProviderName)}
            >
              {providers.map((name) => (
                <option key={name} value={name}>
                  {tSystem(`aiProviderName.${name}`)}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <p className="text-muted text-sm">{t('noProvider')}</p>
        )}
        <p className="text-muted pb-2 text-sm" data-testid="qa-totals">
          {t('totals', { total: all.length, settled, featured: featured.length })}
        </p>
        <div className="flex flex-wrap gap-3 pb-2 text-sm">
          <a
            href={`/api/classes/${classId}/questions?locale=${locale}`}
            className="text-brand-600 dark:text-brand-300 font-medium underline"
          >
            {t('downloadAll')}
          </a>
          <a
            href={`/api/classes/${classId}/questions?featured=1&locale=${locale}`}
            className="text-brand-600 dark:text-brand-300 font-medium underline"
          >
            {t('downloadFeatured')}
          </a>
        </div>
      </div>

      {sessions.length === 0 ? <p className="text-muted text-sm">{t('noSessions')}</p> : null}

      {sessions.map((session, index) => {
        const shown = session.questions.filter(visible);
        const open = session.questions.filter((question) => !question.finalAnswer).length;
        return (
          <details
            key={session.id}
            open={index === 0}
            className="surface-card rounded-xl p-4"
            data-testid="qa-session"
          >
            <summary className="cursor-pointer">
              <span className="font-semibold">{session.groupName}</span>
              {session.subject ? <span className="ml-2 text-sm">{session.subject}</span> : null}
              <span className="text-muted ml-2 text-xs">
                {t('sessionCounts', {
                  total: session.questions.length,
                  open,
                })}
              </span>
            </summary>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                variant="ghost"
                disabled={busy !== null || providers.length === 0 || session.questions.length === 0}
                onClick={() => void suggest(session.id)}
              >
                {busy === `suggest-${session.id}` ? t('suggesting') : t('suggest')}
              </Button>
              <span className="text-muted text-xs">{t('suggestHint')}</span>
            </div>

            <ul className="mt-4 space-y-4">
              {shown.length === 0 ? (
                <li className="text-muted text-sm">{t('nothingHere')}</li>
              ) : (
                shown.map((question) => (
                  <QuestionReviewItem
                    key={question.id}
                    classId={classId}
                    question={question}
                    disabled={busy !== null}
                    onError={setErrorKey}
                  />
                ))
              )}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

function QuestionReviewItem({
  classId,
  question,
  disabled,
  onError,
}: {
  classId: string;
  question: ClassQuestion;
  disabled: boolean;
  onError: (key: string | null) => void;
}) {
  const t = useTranslations('qaReview');
  const tQuestions = useTranslations('questions');
  const format = useFormatter();
  const router = useRouter();

  const groupAnswer = question.answerText && !question.answeredByAi ? question.answerText : null;
  // The model's older answers were written straight into the answer; they are
  // offered as a suggestion now, like the new ones.
  const suggestion =
    question.aiSuggestion?.text ?? (question.answeredByAi ? (question.answerText ?? null) : null);

  const [text, setText] = useState(question.finalAnswer ?? groupAnswer ?? suggestion ?? '');
  const [saving, setSaving] = useState(false);

  async function review(body: Record<string, unknown>) {
    setSaving(true);
    onError(null);
    try {
      const { ok, payload } = await postJson(`/api/classes/${classId}/questions/review`, {
        questionId: question.id,
        ...body,
      });
      if (!ok) {
        onError(errorKeyOf(payload));
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const busy = disabled || saving;

  return (
    <li className="rounded-lg border border-[var(--border-subtle)] p-3" data-testid="qa-question">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{tQuestions(`categories.${question.category}`)}</Badge>
        <span className="text-muted text-xs tabular-nums">▲ {question.upvotes}</span>
        <span className="text-muted text-xs">
          <span className="font-mono">{question.askedByStudentId}</span> {question.askedByName}
        </span>
        {question.finalAnswer ? <Badge tone="brand">{t('settled')}</Badge> : null}
        {question.featuredQuestion ? (
          <Badge tone="accent">{tQuestions('featuredQuestion')}</Badge>
        ) : null}
        {question.featuredAnswer ? (
          <Badge tone="accent">{tQuestions('featuredAnswer')}</Badge>
        ) : null}
      </div>
      <p className="mt-2 text-sm font-medium">{question.text}</p>

      {groupAnswer ? (
        <div className="mt-3 border-l-2 border-[var(--border-subtle)] pl-3">
          <p className="text-muted text-xs">
            {t('groupAnswer', { name: question.answeredByName ?? '' })} ·{' '}
            {tQuestions(question.answerChannel === 'app' ? 'inApp' : 'inClass')}
          </p>
          <p className="mt-1 text-sm">{groupAnswer}</p>
        </div>
      ) : (
        <p className="text-muted mt-3 text-xs">{t('noGroupAnswer')}</p>
      )}

      {suggestion ? (
        <div className="mt-3 rounded-lg border border-dashed border-[var(--border-subtle)] p-3">
          <p className="text-muted text-xs">
            {t('suggestionFrom', {
              model: question.aiSuggestion?.model ?? question.answeredByName ?? '',
            })}
            {(question.aiSuggestion?.groundedInCase ?? question.aiGroundedInCase) === false
              ? ` · ${t('notGrounded')}`
              : ''}
          </p>
          <p className="mt-1 text-sm">{suggestion}</p>
        </div>
      ) : null}

      <div className="mt-3 space-y-2">
        <Textarea
          aria-label={t('finalLabel')}
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        {question.finalAnswer && question.finalizedAt ? (
          <p className="text-muted text-xs">
            {t('settledAt', {
              name: question.finalizedByName ?? '',
              when: format.dateTime(new Date(question.finalizedAt), {
                dateStyle: 'short',
                timeStyle: 'short',
              }),
            })}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || text.trim().length < 10}
            onClick={() => void review({ finalAnswer: text })}
          >
            {t('settle')}
          </Button>
          {groupAnswer ? (
            <Button variant="ghost" disabled={busy} onClick={() => setText(groupAnswer)}>
              {t('useGroup')}
            </Button>
          ) : null}
          {suggestion ? (
            <Button variant="ghost" disabled={busy} onClick={() => setText(suggestion)}>
              {t('useSuggestion')}
            </Button>
          ) : null}
          {question.finalAnswer ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void review({ finalAnswer: null })}
            >
              {t('unsettle')}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void review({ featuredQuestion: !question.featuredQuestion })}
          >
            {question.featuredQuestion ? t('unmarkQuestion') : t('markQuestion')}
          </Button>
          <Button
            variant="ghost"
            disabled={busy || (!question.finalAnswer && !groupAnswer)}
            onClick={() => void review({ featuredAnswer: !question.featuredAnswer })}
          >
            {question.featuredAnswer ? t('unmarkAnswer') : t('markAnswer')}
          </Button>
        </div>
      </div>
    </li>
  );
}

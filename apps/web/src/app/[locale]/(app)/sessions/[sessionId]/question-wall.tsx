'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  DEFAULT_PRESENTATION_ROLES,
  MAX_SELECTED_QUESTIONS,
  roleKeyOf,
  QUESTION_CATEGORIES,
  type ClassQuestion,
} from '@casestudyhub/shared';
import { Alert, Button, Field, Input, Select } from '@/components/ui/form';
import { Badge } from '@/components/ui/card';

/**
 * The question wall.
 *
 * Every student asks one question; the group answers two or three aloud and
 * the rest become the case's question bank.
 *
 * The list is handed in by the room, which polls once for every panel rather
 * than through a live subscription: the room does not need sub-second updates,
 * and polling keeps every read behind the server's authorisation checks.
 */
export function QuestionWall({
  sessionId,
  questions,
  votes,
  ownUid,
  isStaff,
  isPresenter,
  canAsk,
  questionsOpen,
  onChanged,
}: {
  sessionId: string;
  questions: ClassQuestion[];
  votes: string[];
  ownUid: string;
  isStaff: boolean;
  isPresenter: boolean;
  canAsk: boolean;
  questionsOpen: boolean;
  /** Asks the room to poll again, so every panel sees the same state. */
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('questions');
  const tRoles = useTranslations('roles');
  const tError = useTranslations();

  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);

  const own = questions.find((question) => question.askedByUid === ownUid);
  const selectedCount = questions.filter((question) => question.status === 'selected').length;
  const voted = new Set(votes);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setErrorKey(null);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setErrorKey(payload?.error?.messageKey ?? 'errors.unexpected');
        return false;
      }
      await onChanged();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await send({
      action: 'ask',
      category: String(form.get('category') ?? 'clarification'),
      roleId: String(form.get('roleId') ?? '') || null,
      text: String(form.get('text') ?? ''),
      anonymousToClass: form.get('anonymousToClass') === 'on',
    });
  }

  return (
    <div className="space-y-6">
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}

      {canAsk && questionsOpen ? (
        <form onSubmit={ask} className="space-y-4">
          <p className="text-muted text-sm">{own ? t('editHint') : t('askHint')}</p>

          <Field label={t('yourQuestion')} htmlFor="text">
            <textarea
              id="text"
              name="text"
              required
              minLength={10}
              maxLength={1000}
              rows={3}
              defaultValue={own?.text ?? ''}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('category')} htmlFor="category">
              <Select id="category" name="category" defaultValue={own?.category ?? 'clarification'}>
                {QUESTION_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {t(`categories.${category}`)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('aboutRole')} htmlFor="roleId" hint={t('aboutRoleHint')}>
              <Select id="roleId" name="roleId" defaultValue={own?.roleId ?? ''}>
                <option value="">{t('anyRole')}</option>
                {DEFAULT_PRESENTATION_ROLES.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.id} · {tRoles(`${role.key}.title`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Input
              id="anonymousToClass"
              name="anonymousToClass"
              type="checkbox"
              defaultChecked={own?.anonymousToClass ?? true}
              className="h-4 w-4"
            />
            {t('anonymous')}
          </label>

          <Button type="submit" disabled={busy}>
            {own ? t('updateQuestion') : t('sendQuestion')}
          </Button>
        </form>
      ) : null}

      {!questionsOpen ? <p className="text-muted text-sm">{t('closed')}</p> : null}

      <div>
        <h3 className="text-sm font-semibold">
          {t('count', { count: questions.length })}
          {isPresenter
            ? ` · ${t('selectedOf', { count: selectedCount, max: MAX_SELECTED_QUESTIONS })}`
            : ''}
        </h3>

        <ul className="mt-3 space-y-3">
          {questions.length === 0 ? (
            <li className="text-muted text-sm">{t('none')}</li>
          ) : (
            questions.map((question) => {
              const asker = isStaff
                ? question.askedByName
                : question.anonymousToClass
                  ? null
                  : question.askedByName;
              const hasVoted = voted.has(question.id);

              return (
                <li key={question.id} className="surface-card rounded-xl p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{t(`categories.${question.category}`)}</Badge>
                      {question.roleId ? (
                        <Badge tone="accent">{tRoles(`${roleKeyOf(question.roleId)}.title`)}</Badge>
                      ) : null}
                      {question.status === 'selected' ? (
                        <Badge tone="brand">{t('selected')}</Badge>
                      ) : null}
                      {question.status === 'answered' ? (
                        <Badge tone="brand">{t('answered')}</Badge>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      disabled={busy || question.askedByUid === ownUid}
                      onClick={() => void send({ action: 'upvote', questionId: question.id })}
                      aria-label={t('upvote')}
                      className={`surface-card rounded-full px-3 py-1 text-sm font-medium tabular-nums disabled:opacity-50 ${
                        hasVoted ? 'border-brand-500 text-brand-600 dark:text-brand-300' : ''
                      }`}
                    >
                      ▲ {question.upvotes}
                    </button>
                  </div>

                  <p className="mt-3 text-sm">{question.text}</p>
                  {asker ? <p className="text-muted mt-1 text-xs">{asker}</p> : null}

                  {question.answerText ? (
                    <div className="border-brand-300 mt-3 border-l-2 pl-3">
                      <p className="text-sm">{question.answerText}</p>
                      <p className="text-muted mt-1 text-xs">
                        {question.answeredByName}
                        {question.answeredByAi ? ` · ${t('byAi')}` : ''}
                      </p>
                    </div>
                  ) : null}

                  {(isPresenter || isStaff) && question.status !== 'answered' ? (
                    <div className="mt-3 space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            void send({
                              action: 'select',
                              questionId: question.id,
                              selected: question.status !== 'selected',
                            })
                          }
                        >
                          {question.status === 'selected' ? t('deselect') : t('select')}
                        </Button>
                        {question.status === 'selected' ? (
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              setAnswering(answering === question.id ? null : question.id)
                            }
                          >
                            {t('recordAnswer')}
                          </Button>
                        ) : null}
                      </div>

                      {answering === question.id ? (
                        <form
                          onSubmit={async (event) => {
                            event.preventDefault();
                            const form = new FormData(event.currentTarget);
                            const ok = await send({
                              action: 'answer',
                              questionId: question.id,
                              answerText: String(form.get('answerText') ?? ''),
                            });
                            if (ok) setAnswering(null);
                          }}
                          className="space-y-2"
                        >
                          <textarea
                            name="answerText"
                            required
                            minLength={10}
                            rows={3}
                            aria-label={t('recordAnswer')}
                            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-sm"
                          />
                          <Button type="submit" disabled={busy}>
                            {t('saveAnswer')}
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}

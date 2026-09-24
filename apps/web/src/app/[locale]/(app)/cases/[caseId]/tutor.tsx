'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { TUTOR_MODES, type TutorMode, type TutorSession } from '@casestudyhub/shared';
import { Alert, Button, Field, Select } from '@/components/ui/form';

/**
 * The tutor a student can talk to about this case.
 *
 * Four modes, because a tutor that answers everything is a ghostwriter: it
 * explains, asks back, challenges an argument, or sets practice. The note
 * under the form says plainly that it will not write the submission, which is
 * also what the model is told.
 */
export function Tutor({
  caseId,
  available,
  initial,
}: {
  caseId: string;
  available: boolean;
  initial: TutorSession | null;
}) {
  const t = useTranslations('tutor');
  const tError = useTranslations();

  const [session, setSession] = useState(initial);
  const [mode, setMode] = useState<TutorMode>('explain');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!available) {
    return <p className="text-muted text-sm">{t('notConfigured')}</p>;
  }

  async function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = String(new FormData(form).get('message') ?? '');
    setBusy(true);
    setErrorKey(null);

    try {
      const response = await fetch(`/api/cases/${caseId}/tutor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, message }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setErrorKey(payload?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      setSession(payload.session);
      form.reset();
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await fetch(`/api/cases/${caseId}/tutor`, { method: 'DELETE' });
      setSession(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}

      {session && session.turns.length > 0 ? (
        <ol className="space-y-3">
          {session.turns.map((turn, index) => (
            <li
              key={`${turn.at}-${index}`}
              className={
                turn.role === 'student'
                  ? 'surface-card rounded-xl p-3 text-sm'
                  : 'border-brand-300 border-l-2 py-1 pl-3 text-sm'
              }
            >
              <p className="text-muted text-xs">
                {turn.role === 'student' ? t('you') : t('tutorLabel')}
                {turn.mode ? ` · ${t(`modes.${turn.mode}.name`)}` : ''}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{turn.text}</p>
            </li>
          ))}
        </ol>
      ) : null}

      <form onSubmit={ask} className="space-y-3">
        <Field label={t('mode')} htmlFor="tutorMode" hint={t(`modes.${mode}.hint`)}>
          <Select
            id="tutorMode"
            name="tutorMode"
            value={mode}
            onChange={(event) => setMode(event.currentTarget.value as TutorMode)}
          >
            {TUTOR_MODES.map((value) => (
              <option key={value} value={value}>
                {t(`modes.${value}.name`)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('message')} htmlFor="message">
          <textarea
            id="message"
            name="message"
            required
            minLength={5}
            maxLength={2000}
            rows={3}
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </Field>

        <p className="text-muted text-xs">{t('willNotWrite')}</p>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? t('thinking') : t('send')}
          </Button>
          {session && session.turns.length > 0 ? (
            <Button variant="ghost" disabled={busy} onClick={() => void clear()}>
              {t('startOver')}
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

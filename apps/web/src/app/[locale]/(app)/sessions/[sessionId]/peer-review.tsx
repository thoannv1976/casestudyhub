'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DEFAULT_PRESENTATION_POLICY, type PeerReview } from '@casestudyhub/shared';
import { Alert, Button, Field, Input } from '@/components/ui/form';

/**
 * The class scores the group that has just presented.
 *
 * The same rubric the lecturer marks against, one number per criterion, on a
 * phone in a lecture theatre. Submitting again replaces the earlier score
 * rather than adding a second one, and the note under the form says plainly
 * what the score is for: it is evidence the lecturer reads, never arithmetic
 * that moves a mark.
 */
export function PeerReviewForm({
  sessionId,
  own,
  open,
  onChanged,
}: {
  sessionId: string;
  own: PeerReview | null;
  open: boolean;
  /** Asks the room to poll again, so every panel sees the same state. */
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('peerReview');
  const tRubric = useTranslations('rubric');
  const tError = useTranslations();

  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rubric = DEFAULT_PRESENTATION_POLICY.rubric;

  if (!open) {
    return <p className="text-muted text-sm">{own ? t('closedWithScore') : t('closed')}</p>;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setErrorKey(null);
    setNotice(null);

    try {
      const scores = Object.fromEntries(
        rubric.criteria.map((criterion) => [criterion.id, Number(form.get(criterion.id))]),
      );
      const response = await fetch(`/api/sessions/${sessionId}/peer-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scores, comment: String(form.get('comment') ?? '') || undefined }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setErrorKey(payload?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      const payload = await response.json();
      setNotice(t('saved', { total: payload.review.total }));
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <p className="text-muted text-sm">{own ? t('editHint') : t('hint')}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        {rubric.criteria.map((criterion) => (
          <Field
            key={criterion.id}
            label={`${tRubric(criterion.key.replace(/^rubric\./, ''))} · ${criterion.maxPoints}`}
            htmlFor={criterion.id}
          >
            <Input
              id={criterion.id}
              name={criterion.id}
              type="number"
              inputMode="numeric"
              min={0}
              max={criterion.maxPoints}
              step={1}
              required
              defaultValue={own?.scores[criterion.id] ?? ''}
            />
          </Field>
        ))}
      </div>

      <Field label={t('comment')} htmlFor="comment" hint={t('commentHint')}>
        <textarea
          id="comment"
          name="comment"
          rows={3}
          maxLength={2000}
          defaultValue={own?.comment ?? ''}
          className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </Field>

      <p className="text-muted text-xs">{t('evidenceOnly')}</p>

      <Button type="submit" disabled={busy}>
        {own ? t('update') : t('submit')}
      </Button>
    </form>
  );
}

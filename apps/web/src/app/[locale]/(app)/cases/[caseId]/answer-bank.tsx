'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button } from '@/components/ui/form';

/**
 * Asking the model to answer everything the room did not.
 *
 * It never overwrites an answer a student gave aloud, and it answers in
 * batches so one very large class does not become one very large prompt - and
 * so a failure halfway through still leaves the earlier answers written.
 */
export function AnswerBank({
  caseId,
  available,
  pending,
}: {
  caseId: string;
  available: boolean;
  pending: number;
}) {
  const t = useTranslations('caseBank');
  const tError = useTranslations();
  const router = useRouter();

  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!available) {
    return <p className="text-muted text-sm">{t('aiNotConfigured')}</p>;
  }

  async function run() {
    setBusy(true);
    setErrorKey(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/cases/${caseId}/answers`, { method: 'POST' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setErrorKey(payload?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      setNotice(
        t('answeredNotice', {
          answered: payload.result.answered,
          ungrounded: payload.result.ungrounded,
        }),
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <p className="text-muted text-sm">{t('answerHint')}</p>
      <Button disabled={busy || pending === 0} onClick={() => void run()}>
        {busy ? t('answering') : t('answerAction', { count: pending })}
      </Button>
    </div>
  );
}

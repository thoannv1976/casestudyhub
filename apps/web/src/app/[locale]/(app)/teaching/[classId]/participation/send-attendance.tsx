'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardBody, CardTitle } from '@/components/ui/card';
import { Alert, Button } from '@/components/ui/form';

/**
 * Sends the attendance score to Moodle's gradebook, on the lecturer's word.
 * Nothing sends it on its own: it moves after every presentation.
 */
export function SendAttendanceToMoodle({
  classId,
  columns,
}: {
  classId: string;
  /** Attendance activities in Moodle that have a gradebook column. */
  columns: number;
}) {
  const t = useTranslations('participation');
  const tAll = useTranslations();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function send() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/lti/classes/${classId}/grades`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kinds: ['attendance'] }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage({ tone: 'error', text: tAll(body?.error?.messageKey ?? 'errors.unexpected') });
        return;
      }
      setMessage(
        body.failed > 0
          ? { tone: 'error', text: t('moodlePartly', { rows: body.rows, failed: body.failed }) }
          : { tone: 'success', text: t('moodleDone', { rows: body.rows }) },
      );
    } catch {
      setMessage({ tone: 'error', text: tAll('errors.networkError') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>{t('moodleTitle')}</CardTitle>
      <CardBody>{columns > 0 ? t('moodleHint') : t('moodleNoColumn')}</CardBody>
      {message ? (
        <div className="mt-3">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      ) : null}
      {columns > 0 ? (
        <div className="mt-4">
          <Button onClick={send} disabled={busy}>
            {busy ? t('moodleSending') : t('moodleSend')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

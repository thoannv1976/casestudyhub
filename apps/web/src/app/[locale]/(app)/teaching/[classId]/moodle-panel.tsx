'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button } from '@/components/ui/form';

/**
 * The class as Moodle sees it: which course is linked, which activities point
 * here, and one button to send every published mark to Moodle's gradebook.
 */
export function MoodlePanel({
  classId,
  courses,
  activities,
}: {
  classId: string;
  courses: { key: string; title: string }[];
  activities: { key: string; title: string; kind: string; hasColumn: boolean }[];
}) {
  const t = useTranslations('lti');
  const tAll = useTranslations();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const graded = activities.filter((activity) => activity.kind !== 'class' && activity.hasColumn);

  async function sendAll() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/lti/classes/${classId}/grades`, { method: 'POST' });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage({ tone: 'error', text: tAll(body?.error?.messageKey ?? 'errors.unexpected') });
        return;
      }
      setMessage(
        body.failed > 0
          ? { tone: 'error', text: t('sendPartly', { rows: body.rows, failed: body.failed }) }
          : {
              tone: 'success',
              text: t('sendDone', { rows: body.rows, activities: body.activities }),
            },
      );
    } catch {
      setMessage({ tone: 'error', text: tAll('errors.networkError') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm">
        {t('linkedTo')} <strong>{courses.map((course) => course.title).join(', ')}</strong>
      </p>
      {activities.length > 0 ? (
        <ul className="text-muted list-disc space-y-1 pl-5 text-sm">
          {activities.map((activity) => (
            <li key={activity.key}>
              {activity.title || t('untitledActivity')} · {t(`kind.${activity.kind}`)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted text-sm">{t('noActivitiesYet')}</p>
      )}
      <p className="text-muted text-sm">{t('autoSendHint')}</p>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <Button onClick={sendAll} disabled={busy || graded.length === 0}>
        {busy ? t('sending') : t('sendAll')}
      </Button>
    </div>
  );
}

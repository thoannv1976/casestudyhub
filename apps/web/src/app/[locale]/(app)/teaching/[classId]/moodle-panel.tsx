'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button, Field, Select } from '@/components/ui/form';

/**
 * The class as Moodle sees it: which course is linked, which activities point
 * here, and one button to send every published mark to Moodle's gradebook.
 */
export function MoodlePanel({
  classId,
  courses,
  activities,
  roster,
  otherClasses,
}: {
  classId: string;
  courses: { key: string; title: string }[];
  activities: { key: string; title: string; kind: string; hasColumn: boolean }[];
  roster: { fromMoodle: number; newFromMoodle: number; likelyWrongClass: boolean };
  /** Other active classes of this lecturer, a course may be moved to. */
  otherClasses: { id: string; label: string }[];
}) {
  const t = useTranslations('lti');
  const tAll = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [moveTo, setMoveTo] = useState(otherClasses[0]?.id ?? '');
  const [moving, setMoving] = useState(false);

  async function relink(key: string, title: string) {
    const target = otherClasses.find((item) => item.id === moveTo);
    if (!target || !window.confirm(t('relinkConfirm', { course: title, target: target.label })))
      return;
    setMoving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/lti/link', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, classId: moveTo }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage({ tone: 'error', text: tAll(body?.error?.messageKey ?? 'errors.unexpected') });
        return;
      }
      router.push(`/teaching/${moveTo}`);
      router.refresh();
    } catch {
      setMessage({ tone: 'error', text: tAll('errors.networkError') });
    } finally {
      setMoving(false);
    }
  }
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
      <p className="text-muted text-sm">
        {t('rosterMatch', { fromMoodle: roster.fromMoodle, newcomers: roster.newFromMoodle })}
      </p>
      {roster.likelyWrongClass ? <Alert tone="error">{t('likelyWrongClass')}</Alert> : null}
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
      {otherClasses.length > 0 ? (
        <div className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
          <p className="text-sm font-semibold">{t('relinkTitle')}</p>
          <p className="text-muted text-sm">{t('relinkHint')}</p>
          <Field label={t('relinkTarget')} htmlFor="lti-relink">
            <Select
              id="lti-relink"
              value={moveTo}
              onChange={(event) => setMoveTo(event.target.value)}
            >
              {otherClasses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2">
            {courses.map((course) => (
              <Button
                key={course.key}
                variant="ghost"
                disabled={moving || !moveTo}
                onClick={() => relink(course.key, course.title)}
              >
                {moving ? t('relinking') : t('relinkSubmit', { course: course.title })}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

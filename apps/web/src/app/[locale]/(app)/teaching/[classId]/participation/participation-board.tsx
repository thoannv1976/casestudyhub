'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AttendancePolicy } from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Card } from '@/components/ui/card';
import { Alert, Button, Field, Input, Select } from '@/components/ui/form';

export type SessionMark = 'own' | 'both' | 'asked' | 'reviewed' | 'none';

export interface ParticipationRowView {
  studentUid: string;
  studentId: string;
  fullName: string;
  groupName: string | null;
  eligibleSessions: number;
  sessionsAsked: number;
  sessionsReviewed: number;
  questions: number;
  featuredQuestions: number;
  upvotesReceived: number;
  upvotesGiven: number;
  answersInClass: number;
  answersInApp: number;
  featuredAnswers: number;
  attendance: number | null;
  perSession: SessionMark[];
}

const MARK: Record<SessionMark, string> = {
  own: '—',
  both: '●',
  asked: '?',
  reviewed: '✓',
  none: '·',
};

/** Below this a student is worth a word from the lecturer. */
const LOW_ATTENDANCE = 5;

export function ParticipationBoard({
  classId,
  locale,
  sessions,
  rows,
  policy,
}: {
  classId: string;
  locale: string;
  sessions: { id: string; groupName: string }[];
  rows: ParticipationRowView[];
  policy: AttendancePolicy;
}) {
  const t = useTranslations('participation');
  const tError = useTranslations();
  const router = useRouter();

  const [sort, setSort] = useState<'id' | 'low'>('id');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sorted =
    sort === 'id' ? rows : [...rows].sort((a, b) => (a.attendance ?? 11) - (b.attendance ?? 11));

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setErrorKey(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/classes/${classId}/qa-settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          attendancePolicy: {
            questionWeight: Number(form.get('questionWeight') ?? 0.5),
            reviewWeight: Number(form.get('reviewWeight') ?? 0.5),
            featuredBonus: Number(form.get('featuredBonus') ?? 0.5),
          },
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { messageKey?: string };
        } | null;
        setErrorKey(payload?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      setNotice(t('policySaved'));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const scored = rows.filter((row) => row.attendance !== null);
  const average =
    scored.length === 0
      ? null
      : Math.round(
          (scored.reduce((sum, row) => sum + (row.attendance ?? 0), 0) / scored.length) * 10,
        ) / 10;
  const low = scored.filter((row) => (row.attendance ?? 0) < LOW_ATTENDANCE).length;

  return (
    <div className="space-y-6" data-testid="participation-board">
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <h2 className="font-semibold">{t('policyTitle')}</h2>
        <p className="text-muted mt-1 text-sm">{t('policyHint')}</p>
        <form onSubmit={save} className="mt-4 flex flex-wrap items-end gap-4">
          <Field label={t('questionWeight')} htmlFor="questionWeight">
            <Input
              id="questionWeight"
              name="questionWeight"
              type="number"
              min={0}
              max={1}
              step={0.1}
              defaultValue={policy.questionWeight}
              className="w-24"
            />
          </Field>
          <Field label={t('reviewWeight')} htmlFor="reviewWeight">
            <Input
              id="reviewWeight"
              name="reviewWeight"
              type="number"
              min={0}
              max={1}
              step={0.1}
              defaultValue={policy.reviewWeight}
              className="w-24"
            />
          </Field>
          <Field label={t('featuredBonus')} htmlFor="featuredBonus">
            <Input
              id="featuredBonus"
              name="featuredBonus"
              type="number"
              min={0}
              max={2}
              step={0.1}
              defaultValue={policy.featuredBonus}
              className="w-24"
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {t('savePolicy')}
          </Button>
        </form>
      </Card>

      <div className="flex flex-wrap items-end gap-4">
        <Field label={t('sort')} htmlFor="participationSort">
          <Select
            id="participationSort"
            value={sort}
            onChange={(event) => setSort(event.target.value as 'id' | 'low')}
          >
            <option value="id">{t('sortId')}</option>
            <option value="low">{t('sortLow')}</option>
          </Select>
        </Field>
        <p className="text-muted pb-2 text-sm" data-testid="participation-summary">
          {t('summary', {
            sessions: sessions.length,
            students: rows.length,
            average: average ?? '—',
            low,
          })}
        </p>
        <a
          href={`/api/classes/${classId}/participation?locale=${locale}`}
          className="text-brand-600 dark:text-brand-300 pb-2 text-sm font-medium underline"
        >
          {t('download')}
        </a>
      </div>

      <p className="text-muted text-xs">{t('legend')}</p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm" data-testid="participation-table">
          <thead>
            <tr className="text-muted border-b border-[var(--border-subtle)] text-left text-xs">
              <th className="px-2 py-2">{t('studentId')}</th>
              <th className="px-2 py-2">{t('fullName')}</th>
              <th className="px-2 py-2">{t('group')}</th>
              {sessions.map((session, index) => (
                <th key={session.id} className="px-1 py-2 text-center" title={session.groupName}>
                  {index + 1}
                </th>
              ))}
              <th className="px-2 py-2 text-right">{t('questions')}</th>
              <th className="px-2 py-2 text-right">{t('featuredQuestions')}</th>
              <th className="px-2 py-2 text-right">{t('upvotesReceived')}</th>
              <th className="px-2 py-2 text-right">{t('answersShort')}</th>
              <th className="px-2 py-2 text-right">{t('attendance')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.studentUid} className="border-b border-[var(--border-subtle)]">
                <td className="px-2 py-2 font-mono text-xs">{row.studentId}</td>
                <td className="px-2 py-2">{row.fullName}</td>
                <td className="text-muted px-2 py-2 text-xs">{row.groupName ?? '—'}</td>
                {row.perSession.map((mark, index) => (
                  <td key={sessions[index]?.id ?? index} className="px-1 py-2 text-center">
                    {MARK[mark]}
                  </td>
                ))}
                <td className="px-2 py-2 text-right tabular-nums">{row.questions}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.featuredQuestions}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.upvotesReceived}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {row.answersInClass}/{row.answersInApp}
                </td>
                <td
                  className={`px-2 py-2 text-right font-semibold tabular-nums ${
                    row.attendance !== null && row.attendance < LOW_ATTENDANCE
                      ? 'text-red-700 dark:text-red-300'
                      : ''
                  }`}
                >
                  {row.attendance ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

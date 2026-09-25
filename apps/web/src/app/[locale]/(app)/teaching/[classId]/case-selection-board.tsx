'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { Alert, Button, Field, Input, Select } from '@/components/ui/form';

export interface ClaimRow {
  caseStudyId: string;
  caseTitle: string;
  caseCode: string;
  groupName: string;
  claimedByName: string;
  claimedAt: string;
  scheduled: boolean;
}

/**
 * Who has chosen what, and the switch that allows choosing at all.
 *
 * The lecturer still schedules every presentation. A claim says which case a
 * group is working on; a date nobody chose would be a date nobody can keep,
 * and the timetable is not the platform's to invent.
 */
export function CaseSelectionBoard({
  classId,
  mode,
  deadline,
  claims,
  groupCount,
}: {
  classId: string;
  mode: 'lecturer_assigns' | 'groups_choose';
  deadline: string | null;
  claims: ClaimRow[];
  groupCount: number;
}) {
  const t = useTranslations('caseSelection');
  const tError = useTranslations();
  const format = useFormatter();
  const router = useRouter();

  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = String(form.get('deadline') ?? '').trim();

    setBusy(true);
    setErrorKey(null);
    try {
      const response = await fetch(`/api/classes/${classId}/case-selection`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: String(form.get('mode')),
          deadline: raw ? new Date(raw).toISOString() : null,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { messageKey?: string } };
        setErrorKey(body.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function release(caseStudyId: string, caseTitle: string) {
    const reason = window.prompt(t('releasePrompt', { case: caseTitle }));
    if (!reason || reason.trim().length < 3) return;

    setBusy(true);
    setErrorKey(null);
    try {
      const response = await fetch(`/api/classes/${classId}/case-selection`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caseStudyId, reason }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { messageKey?: string } };
        setErrorKey(body.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  /** Written for the datetime-local input, which wants local time with no zone. */
  const deadlineValue = deadline ? new Date(deadline).toISOString().slice(0, 16) : '';

  return (
    <Card>
      <CardTitle>{t('boardTitle')}</CardTitle>
      <p className="text-muted mt-2 text-sm">{t('boardBody')}</p>

      <form onSubmit={save} className="mt-4 flex flex-wrap items-end gap-4">
        <Field label={t('mode')} htmlFor="mode">
          <Select id="mode" name="mode" defaultValue={mode}>
            <option value="lecturer_assigns">{t('modeLecturer')}</option>
            <option value="groups_choose">{t('modeGroups')}</option>
          </Select>
        </Field>
        <Field label={t('deadlineField')} htmlFor="deadline" hint={t('deadlineHint')}>
          <Input id="deadline" name="deadline" type="datetime-local" defaultValue={deadlineValue} />
        </Field>
        <Button type="submit" disabled={busy}>
          {t('save')}
        </Button>
      </form>

      {errorKey ? (
        <div className="mt-4">
          <Alert tone="error">{tError(errorKey)}</Alert>
        </div>
      ) : null}

      {mode === 'groups_choose' ? (
        <div className="mt-6">
          <p className="text-muted text-sm">
            {t('chosenCount', { chosen: claims.length, total: groupCount })}
          </p>

          {claims.length === 0 ? (
            <p className="text-muted mt-3 text-sm">{t('noneChosenYet')}</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm" data-testid="claim-board">
              {claims.map((claim) => (
                <li
                  key={claim.caseStudyId}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--border-subtle)] pb-2"
                >
                  <span className="font-medium">{claim.groupName}</span>
                  <span className="text-muted font-mono text-xs">{claim.caseCode}</span>
                  <span>{claim.caseTitle}</span>
                  <span className="text-muted text-xs">
                    {t('chosenBy', {
                      name: claim.claimedByName,
                      when: format.dateTime(new Date(claim.claimedAt), { dateStyle: 'short' }),
                    })}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    {claim.scheduled ? (
                      <Badge tone="brand">{t('scheduled')}</Badge>
                    ) : (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void release(claim.caseStudyId, claim.caseTitle)}
                      >
                        {t('release')}
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted mt-3 text-xs">{t('schedulingNote')}</p>
        </div>
      ) : null}
    </Card>
  );
}

'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { CaseStudy } from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { Alert, Button } from '@/components/ui/form';

export interface ChoosableCaseView {
  study: Pick<CaseStudy, 'id' | 'caseCode' | 'title' | 'company'>;
  takenByGroupName: string | null;
  takenByOwnGroup: boolean;
}

/**
 * The group picks the case it will work on.
 *
 * Cases another group has taken stay on the list, greyed out and named: a
 * group deciding what to study should see that Amazon has gone to group 2
 * rather than wonder where it went.
 */
export function CasePicker({
  classId,
  cases,
  deadline,
  ownGroupHasCase,
  canChoose,
}: {
  classId: string;
  cases: ChoosableCaseView[];
  deadline: string | null;
  /** True once this group has taken something; the list becomes read-only. */
  ownGroupHasCase: boolean;
  /** False for a student with no group, or after the deadline. */
  canChoose: boolean;
}) {
  const t = useTranslations('caseSelection');
  const tError = useTranslations();
  const format = useFormatter();
  const router = useRouter();

  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function choose(caseStudyId: string) {
    setBusy(caseStudyId);
    setErrorKey(null);
    try {
      const response = await fetch(`/api/classes/${classId}/case-selection`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caseStudyId }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: { messageKey?: string } };
        setErrorKey(body.error?.messageKey ?? 'errors.unexpected');
        // Somebody else may have taken it a second ago, so the list is stale.
        router.refresh();
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardTitle>{t('title')}</CardTitle>
      <p className="text-muted mt-2 text-sm">{t('body')}</p>
      {deadline ? (
        <p className="text-muted mt-1 text-sm">
          {t('deadline', {
            when: format.dateTime(new Date(deadline), {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          })}
        </p>
      ) : null}

      {errorKey ? (
        <div className="mt-4">
          <Alert tone="error">{tError(errorKey)}</Alert>
        </div>
      ) : null}

      <ul className="mt-4 space-y-2 text-sm" data-testid="case-picker">
        {cases.map((row) => (
          <li
            key={row.study.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border-subtle)] pb-2"
          >
            <span className="text-muted font-mono text-xs">{row.study.caseCode}</span>
            <span className="font-medium">{row.study.title}</span>
            {row.study.company ? (
              <span className="text-muted text-xs">{row.study.company}</span>
            ) : null}

            <span className="ml-auto flex items-center gap-2">
              {row.takenByOwnGroup ? (
                <Badge tone="brand">{t('yours')}</Badge>
              ) : row.takenByGroupName ? (
                <Badge tone="neutral">{t('takenBy', { group: row.takenByGroupName })}</Badge>
              ) : (
                <Button
                  variant="ghost"
                  disabled={!canChoose || ownGroupHasCase || busy !== null}
                  onClick={() => void choose(row.study.id)}
                >
                  {busy === row.study.id ? t('choosing') : t('choose')}
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>

      {ownGroupHasCase ? <p className="text-muted mt-4 text-sm">{t('alreadyChosen')}</p> : null}
      {!canChoose && !ownGroupHasCase ? (
        <p className="text-muted mt-4 text-sm">{t('cannotChoose')}</p>
      ) : null}
    </Card>
  );
}

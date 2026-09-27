'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button } from '@/components/ui/form';
import { Badge } from '@/components/ui/card';

/**
 * A group putting its hand up to present the project.
 *
 * First come, first served, and the count is the honest part: a group deciding
 * whether to volunteer wants to know how many places are left, not to find out
 * by pressing.
 */
export function VolunteerCard({
  classId,
  slots,
  taken,
  ownGroupVolunteered,
  ownSlot,
  canVolunteer,
  closedBecause,
  volunteers,
}: {
  classId: string;
  slots: number;
  taken: number;
  ownGroupVolunteered: boolean;
  ownSlot: number | null;
  canVolunteer: boolean;
  closedBecause: 'notOpened' | 'full' | 'deadline' | null;
  /** Group names, in the order they volunteered. */
  volunteers: string[];
}) {
  const t = useTranslations('volunteer');
  const tError = useTranslations();
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function volunteer() {
    setBusy(true);
    setErrorKey(null);
    try {
      const response = await fetch(`/api/classes/${classId}/project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'volunteer' }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { messageKey?: string };
        } | null;
        setErrorKey(payload?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="volunteer-card">
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}

      <p className="text-muted text-sm">{t('hint')}</p>

      <p className="text-sm">
        {t('slotsLeft', { left: Math.max(slots - taken, 0), slots })}
        {closedBecause ? (
          <span className="text-muted ml-2">{t(`closed.${closedBecause}`)}</span>
        ) : null}
      </p>

      {volunteers.length > 0 ? (
        <ol className="flex flex-wrap gap-2 text-sm">
          {volunteers.map((name, index) => (
            <li key={name}>
              <Badge tone="brand">
                {index + 1}. {name}
              </Badge>
            </li>
          ))}
        </ol>
      ) : null}

      {ownGroupVolunteered ? (
        <Alert tone="success">{t('yourGroupIsPresenting', { slot: ownSlot ?? 0 })}</Alert>
      ) : canVolunteer ? (
        <Button onClick={() => void volunteer()} disabled={busy}>
          {t('volunteer')}
        </Button>
      ) : null}
    </div>
  );
}

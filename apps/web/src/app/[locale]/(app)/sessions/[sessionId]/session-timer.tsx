'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  PRESENTATION_ROLE_IDS,
  roleKeyOf,
  type PresentationPolicy,
  type PresentationSession,
} from '@casestudyhub/shared';
import { Button } from '@/components/ui/form';
import { Badge } from '@/components/ui/card';

function format(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * The clock the room watches.
 *
 * The server stores a start timestamp and the time banked so far; this ticks
 * locally from those two numbers. Nothing is written per second, and every
 * device counts from the same server-issued start.
 */
export function SessionTimer({
  session,
  policy,
  canControl,
  onChanged,
}: {
  session: PresentationSession;
  /** Handed down by the room: the framework this session runs under. */
  policy: PresentationPolicy;
  canControl: boolean;
  /** Asks the room to poll again, so every panel sees the same state. */
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('session');
  const tRoles = useTranslations('roles');
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  const running = session.runningSinceMs !== null;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const elapsed =
    session.accumulatedMs +
    (session.runningSinceMs === null ? 0 : Math.max(0, now - session.runningSinceMs));

  const limits = policy.presentation;
  const minutes = elapsed / 60000;
  const tone =
    minutes >= limits.hardStopMinutes
      ? 'text-red-600 dark:text-red-400'
      : minutes >= limits.maxMinutes
        ? 'text-amber-600 dark:text-amber-400'
        : '';

  async function control(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch(`/api/sessions/${session.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={`font-mono text-4xl font-semibold tabular-nums ${tone}`}>
            {format(elapsed)}
          </p>
          <p className="text-muted mt-1 text-xs">
            {t('target', { min: limits.minMinutes, max: limits.maxMinutes })}
            {minutes >= limits.hardStopMinutes ? ` · ${t('hardStop')}` : ''}
          </p>
        </div>
        {session.currentRoleId ? (
          <Badge tone="accent">
            {session.currentRoleId} · {tRoles(`${roleKeyOf(session.currentRoleId)}.title`)}
          </Badge>
        ) : null}
      </div>

      {canControl ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() => void control({ action: running ? 'pause' : 'resume' })}
            >
              {running ? t('pause') : t('resume')}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void control({ action: 'status', status: 'qa' })}
            >
              {t('toQa')}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void control({ action: 'status', status: 'completed' })}
            >
              {t('complete')}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void control({
                  action: 'window',
                  window: 'questions',
                  open: !session.questionsOpen,
                })
              }
            >
              {session.questionsOpen ? t('closeQuestions') : t('openQuestions')}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void control({
                  action: 'window',
                  window: 'peerReview',
                  open: !session.peerReviewOpen,
                })
              }
            >
              {session.peerReviewOpen ? t('closePeerReview') : t('openPeerReview')}
            </Button>
          </div>

          <div className="flex flex-wrap gap-1">
            {PRESENTATION_ROLE_IDS.map((roleId) => (
              <button
                key={roleId}
                type="button"
                disabled={busy}
                onClick={() => void control({ action: 'switchRole', roleId })}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  session.currentRoleId === roleId
                    ? 'bg-brand-600 text-white'
                    : 'surface-card hover:border-brand-400'
                }`}
              >
                {roleId}
                <span className="text-muted ml-1 text-xs tabular-nums">
                  {format(session.roleMs[roleId] ?? 0)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

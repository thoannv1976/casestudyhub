'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Deliverable, Submission } from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button, Input } from '@/components/ui/form';
import { Badge } from '@/components/ui/card';

/**
 * The group's own work area (SRS 7.3): what has to be handed in, what has been
 * handed in, and the whole version history. The history is shown rather than
 * hidden because a lecturer and a group both need to see what was in place at
 * the deadline, not only the newest file.
 *
 * Used for both kinds of work a group owes - a case study assignment and the
 * class group project - because from here they are the same thing: a deadline
 * and a list of what is still missing. Only the case study has a presentation
 * date, so that line appears only when there is one.
 */
export function GroupWorkspace({
  targetId,
  deliverables,
  submissions,
  subjectLabel,
  subject,
  presentationDate,
  submissionDeadline,
  canSubmit,
  overdue,
}: {
  /** The assignment, or the class project's target for this group. */
  targetId: string;
  deliverables: Deliverable[];
  submissions: Submission[];
  subjectLabel: string;
  subject: string;
  presentationDate?: string | null;
  submissionDeadline: string;
  canSubmit: boolean;
  /**
   * Decided on the server. Whether the deadline has passed must never depend
   * on the clock of the device a student is holding (SRS Module 08), and the
   * same answer has to hold for every viewer of this page.
   */
  overdue: boolean;
}) {
  const t = useTranslations('workspace');
  const tDeliverables = useTranslations('deliverables');
  const tError = useTranslations();
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const deadline = new Date(submissionDeadline);

  /**
   * A link and a file take the same road: one endpoint, one version counter,
   * one late flag. Only what is in the body differs.
   */
  async function send(deliverableId: string, body: FormData) {
    setBusy(true);
    setErrorKey(null);
    setErrorDetail(null);
    setNotice(null);
    try {
      body.set('deliverableId', deliverableId);

      const response = await fetch(`/api/assignments/${targetId}/submissions`, {
        method: 'POST',
        body,
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const error = payload?.error;
        setErrorKey(error?.messageKey ?? 'errors.unexpected');
        setErrorDetail(
          error?.details ? Object.values(error.details).filter(Boolean).join(' · ') : null,
        );
        return;
      }

      const version = payload?.submission?.versionNumber ?? 1;
      setNotice(
        payload?.submission?.isLate ? t('submittedLate', { version }) : t('submitted', { version }),
      );
      const input = inputs.current[deliverableId];
      if (input) input.value = '';
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function upload(deliverableId: string, file: File) {
    const body = new FormData();
    body.set('file', file);
    await send(deliverableId, body);
  }

  async function submitUrl(deliverableId: string, url: string) {
    const body = new FormData();
    body.set('url', url);
    await send(deliverableId, body);
  }

  const versionsOf = (deliverableId: string) =>
    submissions
      .filter((submission) => submission.deliverableId === deliverableId)
      .sort((a, b) => b.versionNumber - a.versionNumber);

  return (
    <div className="space-y-6">
      {errorKey ? (
        <Alert tone="error">
          {tError(errorKey)}
          {errorDetail ? ` (${errorDetail})` : ''}
        </Alert>
      ) : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted">{subjectLabel}</dt>
          <dd className="font-medium">{subject}</dd>
        </div>
        {presentationDate ? (
          <div>
            <dt className="text-muted">{t('presentation')}</dt>
            <dd className="font-medium">{new Date(presentationDate).toLocaleString()}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-muted">{t('deadline')}</dt>
          <dd className={`font-medium ${overdue ? 'text-red-600 dark:text-red-400' : ''}`}>
            {deadline.toLocaleString()}
            {overdue ? ` · ${t('closed')}` : ''}
          </dd>
        </div>
      </dl>

      <ul className="space-y-3">
        {deliverables.map((deliverable) => {
          const versions = versionsOf(deliverable.id);
          const current = versions[0];

          return (
            <li key={deliverable.id} className="surface-card rounded-xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">
                    {tDeliverables(deliverable.key.replace('deliverables.', ''))}
                    {deliverable.required ? (
                      <span className="ml-1 text-red-600 dark:text-red-400" aria-hidden="true">
                        *
                      </span>
                    ) : null}
                  </h3>
                  <p className="text-muted mt-1 text-xs">{deliverable.formats.join(' / ')}</p>
                </div>
                {current ? (
                  <Badge tone={current.isLate ? 'neutral' : 'brand'}>
                    {current.isLate
                      ? t('versionLate', { version: current.versionNumber })
                      : t('version', { version: current.versionNumber })}
                  </Badge>
                ) : deliverable.required ? (
                  <Badge>{t('missing')}</Badge>
                ) : null}
              </div>

              {versions.length > 0 ? (
                <ul className="mt-3 space-y-1 text-sm">
                  {versions.map((submission) => (
                    <li key={submission.id} className="flex flex-wrap items-center gap-2">
                      {/* A link leaves this platform, so it says where it goes
                          and opens in its own tab; a file is served by us. */}
                      <a
                        href={submission.externalUrl ?? `/api/submissions/${submission.id}/file`}
                        target={submission.externalUrl ? '_blank' : undefined}
                        rel={submission.externalUrl ? 'noreferrer' : undefined}
                        className="text-brand-600 dark:text-brand-300 underline"
                      >
                        v{submission.versionNumber} · {submission.fileName}
                      </a>
                      {submission.externalUrl ? (
                        <span className="text-muted text-xs">{t('externalLink')}</span>
                      ) : null}
                      <span className="text-muted text-xs">
                        {new Date(submission.submittedAt).toLocaleString()}
                      </span>
                      {submission.isLate ? (
                        <span className="text-xs text-red-600 dark:text-red-400">{t('late')}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              {canSubmit && deliverable.formats.includes('LINK') ? (
                <form
                  className="mt-3 flex flex-wrap gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const field = new FormData(event.currentTarget).get('url');
                    if (typeof field === 'string' && field.trim()) {
                      void submitUrl(deliverable.id, field.trim());
                      event.currentTarget.reset();
                    }
                  }}
                >
                  <Input
                    name="url"
                    type="url"
                    required
                    placeholder="https://www.youtube.com/watch?v=…"
                    aria-label={t('linkFor', {
                      deliverable: tDeliverables(deliverable.key.replace('deliverables.', '')),
                    })}
                    className="flex-1"
                  />
                  <Button type="submit" disabled={busy}>
                    {t('submitLink')}
                  </Button>
                </form>
              ) : canSubmit ? (
                <input
                  ref={(element) => {
                    inputs.current[deliverable.id] = element;
                  }}
                  id={`submit-${deliverable.id}`}
                  type="file"
                  disabled={busy}
                  aria-label={t('uploadFor', {
                    deliverable: tDeliverables(deliverable.key.replace('deliverables.', '')),
                  })}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void upload(deliverable.id, file);
                  }}
                  className="file:bg-brand-600 mt-3 block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
                />
              ) : null}
            </li>
          );
        })}
      </ul>

      {canSubmit && overdue ? <p className="text-muted text-xs">{t('lateWarning')}</p> : null}
    </div>
  );
}

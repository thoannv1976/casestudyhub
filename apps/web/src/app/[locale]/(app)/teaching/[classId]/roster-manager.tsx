'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ClassEnrollment } from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button } from '@/components/ui/form';

interface ImportPreview {
  dryRun: boolean;
  wouldImport?: number;
  created?: number;
  updated?: number;
  skipped?: { studentId: string; messageKey: string }[];
  problems?: { line: number; messageKey: string; value?: string }[];
}

/**
 * Import runs in two steps on purpose: a dry run first, so the lecturer sees
 * how many rows would be created and which lines are wrong, and can fix the
 * file before anything is written.
 */
export function RosterManager({ classId, roster }: { classId: string; roster: ClassEnrollment[] }) {
  const t = useTranslations('roster');
  const tError = useTranslations();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [content, setContent] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(dryRun: boolean, text: string) {
    setBusy(true);
    setErrorKey(null);
    try {
      const response = await fetch(`/api/classes/${classId}/import${dryRun ? '?dryRun=1' : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: text,
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setErrorKey(body?.error?.messageKey ?? 'errors.unexpected');
        return;
      }

      setPreview(body);
      if (!dryRun) {
        setContent(null);
        if (fileInput.current) fileInput.current.value = '';
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function onFileChosen(file: File) {
    const text = await file.text();
    setContent(text);
    setPreview(null);
    await send(true, text);
  }

  async function approve(enrollmentId: string) {
    setBusy(true);
    setErrorKey(null);
    try {
      const response = await fetch(`/api/classes/${classId}/roster`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setErrorKey(body?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(enrollmentId: string, studentId: string) {
    const reason = window.prompt(t('removeReasonPrompt', { studentId }));
    if (!reason || reason.trim().length < 3) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/classes/${classId}/roster`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentId, reason }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setErrorKey(body?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const active = roster.filter((row) => row.status !== 'removed');
  // Students who signed up and are waiting for a decision. A pending row with
  // no account is somebody from the imported list who has not signed up yet -
  // there is nothing to approve there.
  const waiting = active.filter((row) => row.status === 'pending' && row.studentUid);

  return (
    <div className="space-y-6">
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}

      <div className="space-y-3">
        <label htmlFor="roster-file" className="block text-sm font-medium">
          {t('importLabel')}
        </label>
        <input
          id="roster-file"
          ref={fileInput}
          type="file"
          accept=".csv,text/csv,text/plain"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onFileChosen(file);
          }}
          className="file:bg-brand-600 block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
        />
        <p className="text-muted text-xs">{t('importHint')}</p>
      </div>

      {preview ? (
        <div className="surface-card space-y-3 rounded-xl p-4 text-sm">
          {preview.dryRun ? (
            <>
              <p className="font-medium">
                {t('previewCount', { count: preview.wouldImport ?? 0 })}
              </p>
              {(preview.problems?.length ?? 0) > 0 ? (
                <div>
                  <p className="font-medium text-red-600 dark:text-red-400">
                    {t('previewProblems', { count: preview.problems?.length ?? 0 })}
                  </p>
                  <ul className="text-muted mt-2 space-y-1">
                    {preview.problems?.slice(0, 10).map((problem, index) => (
                      <li key={`${problem.line}-${index}`}>
                        {t('line', { line: problem.line })}: {tError(problem.messageKey)}
                        {problem.value ? ` — ${problem.value}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {(preview.wouldImport ?? 0) > 0 && content ? (
                <Button onClick={() => void send(false, content)} disabled={busy}>
                  {t('confirmImport', { count: preview.wouldImport ?? 0 })}
                </Button>
              ) : null}
            </>
          ) : (
            <p className="font-medium">
              {t('imported', { created: preview.created ?? 0, updated: preview.updated ?? 0 })}
            </p>
          )}
        </div>
      ) : null}

      {waiting.length > 0 ? (
        <div className="surface-card rounded-xl p-4">
          <h3 className="text-sm font-semibold">{t('waitingTitle', { count: waiting.length })}</h3>
          <ul className="mt-3 space-y-2">
            {waiting.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span>
                  <span className="font-mono">{row.studentId}</span> — {row.fullName}
                </span>
                <span className="flex gap-2">
                  <Button disabled={busy} onClick={() => void approve(row.id)}>
                    {t('approve')}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void remove(row.id, row.studentId)}
                  >
                    {t('reject')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="surface-card overflow-x-auto rounded-xl">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border-subtle)]">
              <th scope="col" className="px-4 py-3 font-semibold">
                {t('studentId')}
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                {t('fullName')}
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                {t('status')}
              </th>
              <th scope="col" className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {active.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-muted px-4 py-6 text-center">
                  {t('empty')}
                </td>
              </tr>
            ) : (
              active.map((row) => (
                <tr key={row.id} className="border-b border-[var(--border-subtle)]">
                  <td className="px-4 py-3 font-mono">{row.studentId}</td>
                  <td className="px-4 py-3">{row.fullName}</td>
                  <td className="px-4 py-3">
                    {!row.studentUid ? (
                      <span className="text-muted">{t('notJoined')}</span>
                    ) : row.status === 'pending' ? (
                      <span className="text-amber-600 dark:text-amber-400">{t('waiting')}</span>
                    ) : (
                      <span className="text-brand-600 dark:text-brand-300">{t('joined')}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void remove(row.id, row.studentId)}
                    >
                      {t('remove')}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

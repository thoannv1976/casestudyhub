'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Card, CardTitle } from '@/components/ui/card';
import { Alert, Button } from '@/components/ui/form';

interface ImportedAccount {
  studentId: string;
  fullName: string;
  email: string;
  temporaryPassword: string;
}

interface Outcome {
  created: ImportedAccount[];
  skipped: { studentId: string; messageKey: string }[];
  problems: { line: number; messageKey: string }[];
  dryRun: boolean;
}

/**
 * Creating accounts from a list, for the students who cannot register.
 *
 * Always previewed first: the administrator sees which lines are wrong and who
 * already has an account before anything is created. The temporary passwords
 * appear once, on the real run, and are never retrievable afterwards.
 */
export function AccountImport() {
  const t = useTranslations('userAdmin');
  const tError = useTranslations();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [content, setContent] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(dryRun: boolean) {
    if (!content) return;
    setBusy(true);
    setErrorKey(null);

    try {
      const response = await fetch(`/api/admin/users/import${dryRun ? '?dryRun=1' : ''}`, {
        method: 'POST',
        headers: { 'content-type': 'text/csv' },
        body: content,
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: { messageKey?: string } };
        setErrorKey(body.error?.messageKey ?? 'errors.unexpected');
        return;
      }

      setOutcome((await response.json()) as Outcome);
      if (!dryRun) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  /** The one chance to keep the passwords, as a file to hand out. */
  function download() {
    if (!outcome) return;
    const rows = [
      ['Student ID', 'Full name', 'Email', 'Temporary password'],
      ...outcome.created.map((account) => [
        account.studentId,
        account.fullName,
        account.email,
        account.temporaryPassword,
      ]),
    ];
    const csv = `﻿${rows.map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'casestudyhub-accounts.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardTitle>{t('importTitle')}</CardTitle>
      <p className="text-muted mt-2 text-sm">{t('importBody')}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="text-sm"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            setOutcome(null);
            setContent(file ? await file.text() : '');
          }}
        />
        <Button variant="ghost" disabled={!content || busy} onClick={() => void send(true)}>
          {t('importPreview')}
        </Button>
        <Button disabled={!content || busy || !outcome?.dryRun} onClick={() => void send(false)}>
          {t('importCreate')}
        </Button>
      </div>

      {errorKey ? (
        <div className="mt-4">
          <Alert tone="error">{tError(errorKey)}</Alert>
        </div>
      ) : null}

      {outcome ? (
        <div className="mt-4 space-y-3 text-sm" data-testid="import-outcome">
          <p>
            {outcome.dryRun
              ? t('importWouldCreate', { count: outcome.created.length })
              : t('importCreated', { count: outcome.created.length })}
          </p>

          {outcome.problems.length > 0 ? (
            <ul className="space-y-1">
              {outcome.problems.map((problem) => (
                <li
                  key={`${problem.line}-${problem.messageKey}`}
                  className="text-red-600 dark:text-red-400"
                >
                  {t('importLine', { line: problem.line })} — {tError(problem.messageKey)}
                </li>
              ))}
            </ul>
          ) : null}

          {outcome.skipped.length > 0 ? (
            <ul className="space-y-1">
              {outcome.skipped.map((row) => (
                <li key={row.studentId} className="text-muted">
                  <span className="font-mono text-xs">{row.studentId}</span> —{' '}
                  {tError(row.messageKey)}
                </li>
              ))}
            </ul>
          ) : null}

          {!outcome.dryRun && outcome.created.length > 0 ? (
            <>
              <Alert tone="success">{t('importPasswordsOnce')}</Alert>
              <Button variant="ghost" onClick={download}>
                {t('importDownload')}
              </Button>
              <div className="surface-card overflow-x-auto rounded-xl">
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <tbody data-testid="import-passwords">
                    {outcome.created.map((account) => (
                      <tr
                        key={account.studentId}
                        className="border-b border-[var(--border-subtle)]"
                      >
                        <td className="px-3 py-2 font-mono text-xs">{account.studentId}</td>
                        <td className="px-3 py-2">{account.fullName}</td>
                        <td className="px-3 py-2">{account.email}</td>
                        <td className="px-3 py-2 font-mono">{account.temporaryPassword}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

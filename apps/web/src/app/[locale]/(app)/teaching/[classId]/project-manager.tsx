'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Deliverable } from '@casestudyhub/shared';
import { Link, useRouter } from '@/i18n/navigation';
import { Alert, Button, Field, Input } from '@/components/ui/form';

/**
 * The class group project, from the lecturer's side: one deadline for the
 * whole class, and who has handed in what against it.
 *
 * Deliberately one deadline rather than one per group. The project is the same
 * piece of work for everybody, handed in in the final week; per-group dates
 * would be a fairness question nobody asked for.
 */

export interface ProjectRow {
  groupId: string;
  groupName: string;
  /** Whether the lecturer has marked this group's project yet. */
  marked: boolean;
  /** Deliverable id → what the group has handed in, if anything. */
  handedIn: Record<string, { fileName: string; isLate: boolean; versionNumber: number }>;
}

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function ProjectManager({
  classId,
  deadline,
  deliverables,
  rows,
}: {
  classId: string;
  /** Null until the lecturer has set one; the project does not exist before. */
  deadline: string | null;
  deliverables: Deliverable[];
  rows: ProjectRow[];
}) {
  const t = useTranslations('project');
  const tDeliverables = useTranslations('deliverables');
  const tError = useTranslations();
  const router = useRouter();

  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setErrorKey(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/classes/${classId}/project`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deadline: new Date(String(form.get('projectDeadline') ?? '')).toISOString(),
          reason: String(form.get('reason') ?? ''),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { messageKey?: string };
        } | null;
        setErrorKey(payload?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      setNotice(deadline ? t('deadlineMoved') : t('scheduled'));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const name = (deliverable: Deliverable) =>
    tDeliverables(deliverable.key.replace('deliverables.', ''));

  return (
    <div className="space-y-6" data-testid="project-manager">
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('deadlineLabel')} htmlFor="projectDeadline" hint={t('deadlineHint')}>
            <Input
              id="projectDeadline"
              name="projectDeadline"
              type="datetime-local"
              defaultValue={deadline ? toLocalInput(deadline) : ''}
              required
            />
          </Field>
          <Field label={t('reason')} htmlFor="projectReason" hint={t('reasonHint')}>
            <Input id="projectReason" name="reason" minLength={10} required />
          </Field>
        </div>
        <Button type="submit" disabled={busy}>
          {deadline ? t('saveDeadline') : t('schedule')}
        </Button>
      </form>

      {deadline === null ? (
        <p className="text-muted text-sm">{t('notSetYet')}</p>
      ) : rows.length === 0 ? (
        <p className="text-muted text-sm">{t('noGroups')}</p>
      ) : (
        <div className="surface-card overflow-x-auto rounded-xl">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('group')}
                </th>
                {deliverables.map((deliverable) => (
                  <th key={deliverable.id} scope="col" className="px-4 py-3 font-semibold">
                    {name(deliverable)}
                  </th>
                ))}
                <th scope="col" className="px-4 py-3 font-semibold">
                  <span className="sr-only">{t('grade')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.groupId} className="border-b border-[var(--border-subtle)]">
                  <td className="px-4 py-3">{row.groupName}</td>
                  {deliverables.map((deliverable) => {
                    const held = row.handedIn[deliverable.id];
                    return (
                      <td key={deliverable.id} className="px-4 py-3">
                        {held ? (
                          <span>
                            v{held.versionNumber} · {held.fileName}
                            {held.isLate ? (
                              <span className="ml-2 text-red-600 dark:text-red-400">
                                {t('late')}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-muted">{t('missing')}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/teaching/${classId}/project/${row.groupId}`}
                      className="text-brand-600 dark:text-brand-300 font-medium underline"
                    >
                      {row.marked ? t('marked') : t('grade')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button, Field, Select } from '@/components/ui/form';

type ToolAction = 'placeAll' | 'lockAll' | 'unlockAll' | 'mergeSmall';

/**
 * Whole-class group tools: what a lecturer does once per term, at the end of
 * group formation, rather than group by group.
 */
export function GroupTools({ classId, ungrouped }: { classId: string; ungrouped: number }) {
  const t = useTranslations('groups');
  const tAll = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = useState<ToolAction | null>(null);
  const [maxSize, setMaxSize] = useState('1');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function run(action: ToolAction) {
    const question =
      action === 'mergeSmall'
        ? t('mergeConfirm', { size: Number(maxSize) })
        : action === 'placeAll'
          ? t('placeAllConfirm', { count: ungrouped })
          : null;
    if (question && !window.confirm(question)) return;
    setBusy(action);
    setNotice(null);
    try {
      const response = await fetch(`/api/classes/${classId}/groups`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, maxSize: Number(maxSize) }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setNotice({ tone: 'error', text: tAll(body?.error?.messageKey ?? 'errors.unexpected') });
        return;
      }
      const text =
        action === 'placeAll'
          ? t('placeAllDone', { placed: body.placed, unplaced: body.unplaced })
          : action === 'mergeSmall'
            ? t('mergeDone', { moved: body.moved, emptied: body.emptied, stuck: body.stuck })
            : t(action === 'lockAll' ? 'lockAllDone' : 'unlockAllDone', { count: body.changed });
      setNotice({ tone: 'success', text });
      router.refresh();
    } catch {
      setNotice({ tone: 'error', text: tAll('errors.networkError') });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="space-y-3 border-b border-[var(--border-subtle)] pb-6"
      data-testid="group-tools"
    >
      <h3 className="text-sm font-semibold">{t('toolsTitle')}</h3>
      <p className="text-muted text-sm">{t('toolsHint')}</p>
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      <div className="flex flex-wrap items-end gap-3">
        <Button onClick={() => run('placeAll')} disabled={busy !== null || ungrouped === 0}>
          {t('placeAll', { count: ungrouped })}
        </Button>
        <Button variant="ghost" onClick={() => run('lockAll')} disabled={busy !== null}>
          {t('lockAll')}
        </Button>
        <Button variant="ghost" onClick={() => run('unlockAll')} disabled={busy !== null}>
          {t('unlockAll')}
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('mergeSize')} htmlFor="merge-size" hint={t('mergeHint')}>
          <Select
            id="merge-size"
            value={maxSize}
            onChange={(event) => setMaxSize(event.target.value)}
          >
            {['1', '2', '3'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="ghost" onClick={() => run('mergeSmall')} disabled={busy !== null}>
          {t('mergeSmall')}
        </Button>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button, Field, Input } from '@/components/ui/form';

/**
 * Opens a class for the next cohort from this one: same course, cases and
 * settings; no students, no group members, no work and no marks.
 */
export function CloneClassForm({
  classId,
  groupsChoose,
  defaultGroups,
  defaultMaxMembers,
}: {
  classId: string;
  /** Only then does a case-selection deadline mean anything. */
  groupsChoose: boolean;
  defaultGroups: number;
  defaultMaxMembers: number;
}) {
  const t = useTranslations('cloneClass');
  const tAll = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  async function submit(form: FormData) {
    setBusy(true);
    setErrorKey(null);
    const deadline = String(form.get('deadline') ?? '');
    try {
      const response = await fetch(`/api/classes/${classId}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classCode: String(form.get('classCode') ?? ''),
          className: String(form.get('className') ?? ''),
          groupCount: Number(form.get('groupCount')),
          maxMembers: Number(form.get('maxMembers')),
          caseSelectionDeadline: deadline ? new Date(deadline).toISOString() : null,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setErrorKey(body?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      router.push(`/teaching/${body.classId}`);
      router.refresh();
    } catch {
      setErrorKey('errors.networkError');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={submit} className="space-y-4" data-testid="clone-class-form">
      <p className="text-muted text-sm">{t('hint')}</p>
      {errorKey ? <Alert tone="error">{tAll(errorKey)}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('classCode')} htmlFor="clone-code">
          <Input id="clone-code" name="classCode" required minLength={4} maxLength={32} />
        </Field>
        <Field label={t('className')} htmlFor="clone-name">
          <Input id="clone-name" name="className" required minLength={2} maxLength={160} />
        </Field>
        <Field label={t('groupCount')} htmlFor="clone-groups">
          <Input
            id="clone-groups"
            name="groupCount"
            type="number"
            min={1}
            max={50}
            defaultValue={defaultGroups}
            required
          />
        </Field>
        <Field label={t('maxMembers')} htmlFor="clone-max">
          <Input
            id="clone-max"
            name="maxMembers"
            type="number"
            min={2}
            max={12}
            defaultValue={defaultMaxMembers}
            required
          />
        </Field>
        {groupsChoose ? (
          <Field label={t('deadline')} htmlFor="clone-deadline" hint={t('deadlineHint')}>
            <Input id="clone-deadline" name="deadline" type="datetime-local" />
          </Field>
        ) : null}
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? t('creating') : t('submit')}
      </Button>
    </form>
  );
}

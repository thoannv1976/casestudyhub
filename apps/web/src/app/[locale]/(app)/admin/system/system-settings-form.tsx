'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { SystemSettings } from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Card, CardTitle } from '@/components/ui/card';
import { Alert, Button, Field, Input } from '@/components/ui/form';

/**
 * The switches that change how the platform behaves for everybody, at once.
 *
 * Unlike the assessment framework, these are not versioned and not frozen:
 * closing registration is an operational decision that should take effect now,
 * not from the next cohort. The audit log is what makes it answerable.
 */
export function SystemSettingsForm({ settings }: { settings: SystemSettings }) {
  const t = useTranslations('systemAdmin');
  const tError = useTranslations();
  const router = useRouter();

  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    setBusy(true);
    setErrorKey(null);
    setSaved(false);

    try {
      const response = await fetch('/api/admin/system', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          settings: {
            // Spread first: this form does not offer every setting, and a
            // partial object would turn off whatever it leaves out - which is
            // exactly how the deploy script used to turn off the model.
            ...settings,
            registrationOpen: form.get('registrationOpen') === 'on',
            maxImportKb: Number(form.get('maxImportKb')),
            aiMonthlyCallBudget: Number(form.get('aiMonthlyCallBudget')),
          },
          reason: String(form.get('reason') ?? ''),
        }),
      });

      if (!response.ok) {
        const body = (await response.json()) as {
          error?: { messageKey?: string; details?: { fields?: { messageKey: string }[] } };
        };
        setErrorKey(
          body.error?.details?.fields?.[0]?.messageKey ??
            body.error?.messageKey ??
            'errors.unexpected',
        );
        return;
      }

      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} data-testid="system-settings">
      <Card>
        <CardTitle>{t('settingsTitle')}</CardTitle>
        <p className="text-muted mt-2 text-sm">{t('settingsBody')}</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label={t('registrationOpen')}
            htmlFor="registrationOpen"
            hint={t('registrationOpenHint')}
          >
            <Input
              id="registrationOpen"
              name="registrationOpen"
              type="checkbox"
              defaultChecked={settings.registrationOpen}
            />
          </Field>

          <Field label={t('maxImportKb')} htmlFor="maxImportKb" hint={t('maxImportKbHint')}>
            <Input
              id="maxImportKb"
              name="maxImportKb"
              type="number"
              min={16}
              max={8192}
              step={16}
              defaultValue={settings.maxImportKb}
            />
          </Field>

          <Field
            label={t('aiMonthlyCallBudget')}
            htmlFor="aiMonthlyCallBudget"
            hint={t('aiMonthlyCallBudgetHint')}
          >
            <Input
              id="aiMonthlyCallBudget"
              name="aiMonthlyCallBudget"
              type="number"
              min={0}
              max={100000}
              step={10}
              defaultValue={settings.aiMonthlyCallBudget}
            />
          </Field>

          <Field label={t('reason')} htmlFor="reason" hint={t('reasonHint')}>
            <Input id="reason" name="reason" required minLength={3} maxLength={500} />
          </Field>
        </div>

        {errorKey ? (
          <div className="mt-4">
            <Alert tone="error">{tError(errorKey)}</Alert>
          </div>
        ) : null}
        {saved ? (
          <div className="mt-4">
            <Alert tone="success">{t('saved')}</Alert>
          </div>
        ) : null}

        <div className="mt-4">
          <Button type="submit" disabled={busy}>
            {t('save')}
          </Button>
        </div>
      </Card>
    </form>
  );
}

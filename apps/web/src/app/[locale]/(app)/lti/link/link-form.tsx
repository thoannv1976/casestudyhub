'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button, Field, Select } from '@/components/ui/form';

export function LtiLinkForm({
  linkKey,
  classes,
}: {
  linkKey: string;
  classes: { id: string; label: string }[];
}) {
  const t = useTranslations('lti');
  const tAll = useTranslations();
  const router = useRouter();
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErrorKey(null);
    try {
      const response = await fetch('/api/lti/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: linkKey, classId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setErrorKey(body?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      router.replace(`/teaching/${classId}`);
      router.refresh();
    } catch {
      setErrorKey('errors.networkError');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {errorKey ? <Alert tone="error">{tAll(errorKey)}</Alert> : null}
      <Field label={t('linkChooseClass')} htmlFor="lti-class">
        <Select id="lti-class" value={classId} onChange={(event) => setClassId(event.target.value)}>
          {classes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Select>
      </Field>
      <Button onClick={submit} disabled={busy || !classId}>
        {busy ? t('linking') : t('linkSubmit')}
      </Button>
    </div>
  );
}

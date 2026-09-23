'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button, Field, Input } from '@/components/ui/form';
import type { ClassLecturer } from '@casestudyhub/core';

/**
 * Who teaches this class.
 *
 * A lecturer account created by an administrator starts with no class at all,
 * and marking belongs to the lecturer. Somebody already in charge of the class
 * has to be able to hand it over.
 */
export function StaffManager({
  classId,
  lecturers,
}: {
  classId: string;
  lecturers: ClassLecturer[];
}) {
  const t = useTranslations('teaching');
  const tError = useTranslations();
  const router = useRouter();

  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get('lecturerEmail') ?? '');
    setBusy(true);
    setErrorKey(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/classes/${classId}/lecturers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setErrorKey(payload?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      setNotice(t('lecturerAdded', { name: payload.lecturer.fullName }));
      form.reset();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <ul className="space-y-1 text-sm">
        {lecturers.map((lecturer) => (
          <li key={lecturer.uid} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{lecturer.fullName}</span>
            <span className="text-muted text-xs">{lecturer.email}</span>
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="flex flex-wrap items-end gap-3">
        <Field label={t('addLecturer')} htmlFor="lecturerEmail" hint={t('addLecturerHint')}>
          <Input id="lecturerEmail" name="lecturerEmail" type="email" required />
        </Field>
        <Button type="submit" disabled={busy}>
          {t('addLecturerAction')}
        </Button>
      </form>
    </div>
  );
}

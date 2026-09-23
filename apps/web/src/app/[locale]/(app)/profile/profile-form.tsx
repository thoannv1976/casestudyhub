'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { LOCALES, profileUpdateSchema, type ProfileUpdateRequest } from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button, Field, Input, Select } from '@/components/ui/form';

const LOCALE_LABELS: Record<string, string> = { vi: 'Tiếng Việt', en: 'English' };

export function ProfileForm({
  initialFullName,
  initialLanguage,
}: {
  initialFullName: string;
  initialLanguage: 'vi' | 'en';
}) {
  const t = useTranslations('profile');
  const tAuth = useTranslations('auth');
  const tError = useTranslations();
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileUpdateRequest>({
    resolver: zodResolver(profileUpdateSchema),
    defaultValues: { fullName: initialFullName, preferredLanguage: initialLanguage },
  });

  async function onSubmit(values: ProfileUpdateRequest) {
    setErrorKey(null);
    setSaved(false);

    const response = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setErrorKey(body?.error?.messageKey ?? 'errors.unexpected');
      return;
    }

    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}
      {saved ? <Alert tone="success">{t('saved')}</Alert> : null}

      <Field
        label={tAuth('fullName')}
        htmlFor="fullName"
        error={errors.fullName ? tError('errors.validationFailed') : undefined}
      >
        <Input
          id="fullName"
          autoComplete="name"
          aria-invalid={errors.fullName ? 'true' : 'false'}
          {...register('fullName')}
        />
      </Field>

      <Field label={tAuth('preferredLanguage')} htmlFor="preferredLanguage">
        <Select id="preferredLanguage" {...register('preferredLanguage')}>
          {LOCALES.map((value) => (
            <option key={value} value={value}>
              {LOCALE_LABELS[value]}
            </option>
          ))}
        </Select>
      </Field>

      <Button type="submit" disabled={isSubmitting || !isDirty}>
        {isSubmitting ? tAuth('working') : t('save')}
      </Button>
    </form>
  );
}

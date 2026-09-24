'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { joinClassSchema, type JoinClassRequest } from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button, Field, Input } from '@/components/ui/form';

export function JoinClassForm() {
  const t = useTranslations('classes');
  const tAuth = useTranslations('auth');
  const tError = useTranslations();
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<JoinClassRequest>({
    resolver: zodResolver(joinClassSchema),
    defaultValues: { classCode: '' },
  });

  async function onSubmit(values: JoinClassRequest) {
    setErrorKey(null);
    setJoined(null);

    const response = await fetch('/api/classes/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classCode: values.classCode.toUpperCase() }),
    });
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      setErrorKey(body?.error?.messageKey ?? 'errors.unexpected');
      return;
    }

    setJoined(body?.className ?? values.classCode);
    reset();
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}
      {joined ? <Alert tone="success">{t('joined', { className: joined })}</Alert> : null}

      <Field
        label={t('classCode')}
        htmlFor="classCode"
        hint={t('classCodeHint')}
        error={
          errors.classCode
            ? tError(
                errors.classCode.message?.startsWith('errors.')
                  ? errors.classCode.message
                  : 'errors.validationFailed',
              )
            : undefined
        }
      >
        <Input
          id="classCode"
          autoComplete="off"
          placeholder="ECOM-2026-A01"
          className="uppercase"
          aria-invalid={errors.classCode ? 'true' : 'false'}
          {...register('classCode')}
        />
      </Field>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? tAuth('working') : t('join')}
      </Button>
    </form>
  );
}

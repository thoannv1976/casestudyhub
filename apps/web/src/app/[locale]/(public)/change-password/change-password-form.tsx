'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { changePasswordSchema, type ChangePasswordRequest } from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button, Field, Input } from '@/components/ui/form';
import { authErrorKey, signInAndStartSession } from '@/lib/firebase/auth-client';

export function ChangePasswordForm({ email }: { email: string }) {
  const t = useTranslations('password');
  const tAuth = useTranslations('auth');
  const tError = useTranslations();
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordRequest>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(values: ChangePasswordRequest) {
    setErrorKey(null);

    const response = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setErrorKey(body?.error?.messageKey ?? 'errors.unexpected');
      return;
    }

    // Changing the password revoked every session, so sign in again with the
    // new one rather than leaving the user on a dead session.
    try {
      await signInAndStartSession(email, values.newPassword);
      router.replace('/dashboard');
      router.refresh();
    } catch (error) {
      setErrorKey(authErrorKey(error));
      router.replace('/login');
    }
  }

  const messageFor = (key?: string) =>
    key ? tError(key.startsWith('errors.') ? key : 'errors.validationFailed') : undefined;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}

      <Field
        label={t('newPassword')}
        htmlFor="newPassword"
        hint={tAuth('passwordHint')}
        error={messageFor(errors.newPassword?.message)}
      >
        <Input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          aria-invalid={errors.newPassword ? 'true' : 'false'}
          {...register('newPassword')}
        />
      </Field>

      <Field
        label={tAuth('confirmPassword')}
        htmlFor="confirmPassword"
        error={messageFor(errors.confirmPassword?.message)}
      >
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          aria-invalid={errors.confirmPassword ? 'true' : 'false'}
          {...register('confirmPassword')}
        />
      </Field>

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? tAuth('working') : t('submit')}
      </Button>
    </form>
  );
}

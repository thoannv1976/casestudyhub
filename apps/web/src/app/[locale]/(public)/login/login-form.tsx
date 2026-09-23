'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button, Field, Input } from '@/components/ui/form';
import { authErrorKey, signInAndStartSession } from '@/lib/firebase/auth-client';

interface SignInValues {
  email: string;
  password: string;
}

export function LoginForm() {
  const t = useTranslations('auth');
  const tError = useTranslations();
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInValues>({ defaultValues: { email: '', password: '' } });

  async function onSubmit(values: SignInValues) {
    setErrorKey(null);
    try {
      await signInAndStartSession(values.email, values.password);
      router.replace('/dashboard');
      router.refresh();
    } catch (error) {
      setErrorKey(
        error instanceof Error && error.message.startsWith('errors.')
          ? error.message
          : authErrorKey(error),
      );
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}

      <Field
        label={t('email')}
        htmlFor="email"
        error={errors.email ? tError('errors.validationFailed') : undefined}
      >
        <Input
          id="email"
          type="email"
          autoComplete="email"
          aria-invalid={errors.email ? 'true' : 'false'}
          {...register('email', { required: true })}
        />
      </Field>

      <Field
        label={t('password')}
        htmlFor="password"
        error={errors.password ? tError('errors.validationFailed') : undefined}
      >
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={errors.password ? 'true' : 'false'}
          {...register('password', { required: true })}
        />
      </Field>

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? t('working') : t('submitSignIn')}
      </Button>
    </form>
  );
}

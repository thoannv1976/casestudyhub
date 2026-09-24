'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { LOCALES, registerRequestSchema, type RegisterRequest } from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button, Field, Input, Select } from '@/components/ui/form';
import { authErrorKey, signInAndStartSession } from '@/lib/firebase/auth-client';

const LOCALE_LABELS: Record<string, string> = { vi: 'Tiếng Việt', en: 'English' };

export function RegisterForm() {
  const t = useTranslations('auth');
  const tError = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterRequest>({
    // The exact schema the server validates with, so the form cannot accept
    // something the endpoint will reject.
    resolver: zodResolver(registerRequestSchema),
    defaultValues: {
      studentId: '',
      fullName: '',
      email: '',
      password: '',
      confirmPassword: '',
      preferredLanguage: (LOCALES as readonly string[]).includes(locale)
        ? (locale as RegisterRequest['preferredLanguage'])
        : 'vi',
    },
  });

  async function onSubmit(values: RegisterRequest) {
    setErrorKey(null);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setErrorKey(body?.error?.messageKey ?? 'errors.unexpected');
        return;
      }

      // Registration succeeded, so sign in straight away rather than asking
      // for the same password a second time.
      await signInAndStartSession(values.email, values.password);
      router.replace('/dashboard');
      router.refresh();
    } catch (error) {
      setErrorKey(authErrorKey(error));
    }
  }

  // Schema messages are i18n keys. Anything else - a library default that
  // slipped through - falls back to the generic message rather than printing
  // English at a Vietnamese reader.
  const messageFor = (key?: string) =>
    key ? tError(key.startsWith('errors.') ? key : 'errors.validationFailed') : undefined;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}

      <Field
        label={t('studentId')}
        htmlFor="studentId"
        hint={t('studentIdHint')}
        error={messageFor(errors.studentId?.message)}
      >
        <Input
          id="studentId"
          autoComplete="off"
          aria-invalid={errors.studentId ? 'true' : 'false'}
          {...register('studentId')}
        />
      </Field>

      <Field label={t('fullName')} htmlFor="fullName" error={messageFor(errors.fullName?.message)}>
        <Input
          id="fullName"
          autoComplete="name"
          aria-invalid={errors.fullName ? 'true' : 'false'}
          {...register('fullName')}
        />
      </Field>

      <Field label={t('email')} htmlFor="email" error={messageFor(errors.email?.message)}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          aria-invalid={errors.email ? 'true' : 'false'}
          {...register('email')}
        />
      </Field>

      <Field
        label={t('password')}
        htmlFor="password"
        hint={t('passwordHint')}
        error={messageFor(errors.password?.message)}
      >
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={errors.password ? 'true' : 'false'}
          {...register('password')}
        />
      </Field>

      <Field
        label={t('confirmPassword')}
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

      <Field label={t('preferredLanguage')} htmlFor="preferredLanguage">
        <Select id="preferredLanguage" {...register('preferredLanguage')}>
          {LOCALES.map((value) => (
            <option key={value} value={value}>
              {LOCALE_LABELS[value]}
            </option>
          ))}
        </Select>
      </Field>

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? t('working') : t('submitRegister')}
      </Button>
    </form>
  );
}

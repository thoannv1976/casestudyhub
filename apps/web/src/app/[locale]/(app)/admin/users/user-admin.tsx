'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import {
  LOCALES,
  createStaffAccountSchema,
  type CreateStaffAccountRequest,
  type UserProfile,
} from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button, Field, Input, Select } from '@/components/ui/form';

const LOCALE_LABELS: Record<string, string> = { vi: 'Tiếng Việt', en: 'English' };

export function UserAdmin({ users, callerUid }: { users: UserProfile[]; callerUid: string }) {
  const t = useTranslations('userAdmin');
  const tAuth = useTranslations('auth');
  const tError = useTranslations();
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateStaffAccountRequest>({
    resolver: zodResolver(createStaffAccountSchema),
    defaultValues: {
      email: '',
      fullName: '',
      role: 'lecturer',
      temporaryPassword: '',
      preferredLanguage: 'vi',
    },
  });

  async function onSubmit(values: CreateStaffAccountRequest) {
    setErrorKey(null);
    setCreatedEmail(null);

    const response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setErrorKey(body?.error?.messageKey ?? 'errors.unexpected');
      return;
    }

    setCreatedEmail(values.email);
    reset();
    router.refresh();
  }

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setErrorKey(null);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setErrorKey(payload?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function changeRole(user: UserProfile, role: string) {
    const reason = window.prompt(t('roleReasonPrompt', { email: user.email }));
    if (!reason || reason.trim().length < 3) return;
    void patch({ targetUid: user.uid, role, reason });
  }

  function toggleStatus(user: UserProfile) {
    const next = user.status === 'suspended' ? 'active' : 'suspended';
    const reason = window.prompt(t('statusReasonPrompt', { email: user.email }));
    if (!reason || reason.trim().length < 3) return;
    void patch({ targetUid: user.uid, status: next, reason });
  }

  const messageFor = (key?: string) =>
    key ? tError(key.startsWith('errors.') ? key : 'errors.validationFailed') : undefined;

  return (
    <div className="space-y-8">
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {createdEmail ? (
          <Alert tone="success">{t('created', { email: createdEmail })}</Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={tAuth('fullName')}
            htmlFor="staffName"
            error={messageFor(errors.fullName?.message)}
          >
            <Input id="staffName" {...register('fullName')} />
          </Field>

          <Field
            label={tAuth('email')}
            htmlFor="staffEmail"
            error={messageFor(errors.email?.message)}
          >
            <Input id="staffEmail" type="email" {...register('email')} />
          </Field>

          <Field label={t('role')} htmlFor="staffRole">
            <Select id="staffRole" {...register('role')}>
              <option value="lecturer">{t('roleLecturer')}</option>
              <option value="admin">{t('roleAdmin')}</option>
            </Select>
          </Field>

          <Field label={tAuth('preferredLanguage')} htmlFor="staffLanguage">
            <Select id="staffLanguage" {...register('preferredLanguage')}>
              {LOCALES.map((value) => (
                <option key={value} value={value}>
                  {LOCALE_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label={t('temporaryPassword')}
          htmlFor="tempPassword"
          hint={t('temporaryPasswordHint')}
          error={messageFor(errors.temporaryPassword?.message)}
        >
          <Input id="tempPassword" {...register('temporaryPassword')} />
        </Field>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? tAuth('working') : t('createStaff')}
        </Button>
      </form>

      <div className="surface-card overflow-x-auto rounded-xl">
        <table className="w-full min-w-[42rem] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border-subtle)]">
              <th scope="col" className="px-4 py-3 font-semibold">
                {tAuth('fullName')}
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                {tAuth('email')}
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                {t('role')}
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                {t('status')}
              </th>
              <th scope="col" className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isSelf = user.uid === callerUid;
              return (
                <tr key={user.uid} className="border-b border-[var(--border-subtle)]">
                  <td className="px-4 py-3">
                    {user.fullName}
                    {user.studentId ? (
                      <span className="text-muted ml-2 font-mono text-xs">{user.studentId}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{user.email}</td>
                  <td className="px-4 py-3">
                    <Select
                      aria-label={t('role')}
                      value={user.globalRole}
                      disabled={isSelf || busy}
                      onChange={(event) => changeRole(user, event.target.value)}
                    >
                      <option value="student">{t('roleStudent')}</option>
                      <option value="lecturer">{t('roleLecturer')}</option>
                      <option value="admin">{t('roleAdmin')}</option>
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    {user.status === 'suspended' ? t('suspended') : t('active')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      disabled={isSelf || busy}
                      onClick={() => toggleStatus(user)}
                    >
                      {user.status === 'suspended' ? t('unsuspend') : t('suspend')}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-muted text-xs">{t('selfNote')}</p>
    </div>
  );
}

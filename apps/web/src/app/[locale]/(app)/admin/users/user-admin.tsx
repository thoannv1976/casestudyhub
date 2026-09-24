'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import {
  LOCALES,
  matchesSearch,
  createAccountSchema,
  type CreateAccountRequest,
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
  /** Shown once, because this is the only moment the password is readable. */
  const [handedOver, setHandedOver] = useState<{ email: string; password: string } | null>(null);
  const [suggestion, setSuggestion] = useState('');

  /**
   * Filtered here rather than by asking the server again on every keystroke.
   * The page already holds the accounts, and a faculty has hundreds of them,
   * so the answer is instant and costs nothing.
   */
  const [search, setSearch] = useState('');
  const visible = users.filter((user) => matchesSearch(user, search));
  const [busy, setBusy] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateAccountRequest>({
    resolver: zodResolver(createAccountSchema),
    defaultValues: {
      email: '',
      fullName: '',
      role: 'lecturer',
      temporaryPassword: '',
      preferredLanguage: 'vi',
      studentId: '',
    },
  });

  async function onSubmit(values: CreateAccountRequest) {
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
    setNewRole('lecturer');
    router.refresh();
  }

  /** Returns whether it worked, so a caller knows not to close its form. */
  async function patch(body: Record<string, unknown>): Promise<boolean> {
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
        setErrorKey(
          payload?.error?.details?.fields?.[0]?.messageKey ??
            payload?.error?.messageKey ??
            'errors.unexpected',
        );
        return false;
      }
      router.refresh();
      return true;
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

  /**
   * Setting a password and correcting a name both need more than one field and
   * a reason, so they open a panel under the table rather than a prompt box.
   * Only one is open at a time: two half-filled forms for two different people
   * is how the wrong person gets the new password.
   */
  const [editing, setEditing] = useState<{
    user: UserProfile;
    kind: 'password' | 'profile';
  } | null>(null);

  async function resetPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const ok = await patch({
      targetUid: editing.user.uid,
      temporaryPassword: String(form.get('newTemporaryPassword') ?? ''),
      reason: String(form.get('resetReason') ?? ''),
    });
    if (ok) {
      setHandedOver({
        email: editing.user.email,
        password: String(form.get('newTemporaryPassword') ?? ''),
      });
      setEditing(null);
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const ok = await patch({
      targetUid: editing.user.uid,
      fullName: String(form.get('editFullName') ?? ''),
      preferredLanguage: String(form.get('editLanguage') ?? 'vi'),
      reason: String(form.get('profileReason') ?? ''),
    });
    if (ok) setEditing(null);
  }

  /**
   * Which role the create form is on, tracked beside react-hook-form rather
   * than through `watch`: that returns a function the React Compiler will not
   * memoize, and it made this whole component opt out of compilation.
   */
  const roleField = register('role');
  const [newRole, setNewRole] = useState('lecturer');

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
            <Select
              id="staffRole"
              {...roleField}
              onChange={(event) => {
                setNewRole(event.target.value);
                void roleField.onChange(event);
              }}
            >
              <option value="lecturer">{t('roleLecturer')}</option>
              <option value="admin">{t('roleAdmin')}</option>
              <option value="student">{t('roleStudent')}</option>
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

        {newRole === 'student' ? (
          <Field
            label={t('studentId')}
            htmlFor="staffStudentId"
            hint={t('studentIdHint')}
            error={messageFor(errors.studentId?.message)}
          >
            <Input id="staffStudentId" {...register('studentId')} />
          </Field>
        ) : null}

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

      <div className="flex flex-wrap items-center gap-3">
        <Field label={t('search')} htmlFor="userSearch" hint={t('searchHint')}>
          <Input
            id="userSearch"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('searchPlaceholder')}
          />
        </Field>
        <span className="text-muted mt-6 text-sm">
          {t('showing', { shown: visible.length, total: users.length })}
        </span>
      </div>

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
            {visible.map((user) => {
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
                    {user.mustChangePassword ? (
                      <span className="text-muted mt-1 block text-xs">{t('owesPassword')}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setEditing({ user, kind: 'profile' })}
                      >
                        {t('edit')}
                      </Button>
                      <Button
                        variant="ghost"
                        // An administrator sets their own password on their own
                        // page, which asks for the current one first.
                        disabled={isSelf || busy}
                        onClick={() => {
                          setSuggestion(temporaryPassword());
                          setHandedOver(null);
                          setEditing({ user, kind: 'password' });
                        }}
                      >
                        {t('resetPassword')}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={isSelf || busy}
                        onClick={() => toggleStatus(user)}
                      >
                        {user.status === 'suspended' ? t('unsuspend') : t('suspend')}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing?.kind === 'password' ? (
        <form
          onSubmit={resetPassword}
          className="surface-card space-y-4 rounded-xl p-5"
          data-testid="reset-password-panel"
        >
          <h3 className="text-base font-semibold">
            {t('resetPasswordFor', { name: editing.user.fullName })}
          </h3>
          <p className="text-muted text-sm">{t('resetPasswordBody')}</p>

          <Field
            label={t('temporaryPassword')}
            htmlFor="newTemporaryPassword"
            hint={t('temporaryPasswordHint')}
          >
            <div className="flex gap-2">
              <Input
                id="newTemporaryPassword"
                name="newTemporaryPassword"
                defaultValue={suggestion}
                required
                minLength={8}
              />
              <Button variant="ghost" onClick={() => setSuggestion(temporaryPassword())}>
                {t('suggest')}
              </Button>
            </div>
          </Field>

          <Field label={t('reason')} htmlFor="resetReason" hint={t('resetReasonHint')}>
            <Input id="resetReason" name="resetReason" required minLength={10} maxLength={500} />
          </Field>

          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {t('resetPasswordConfirm')}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      ) : null}

      {editing?.kind === 'profile' ? (
        <form
          onSubmit={saveProfile}
          className="surface-card space-y-4 rounded-xl p-5"
          data-testid="edit-profile-panel"
        >
          <h3 className="text-base font-semibold">
            {t('editProfileFor', { name: editing.user.fullName })}
          </h3>
          <p className="text-muted text-sm">
            {t('editProfileBody', { email: editing.user.email })}
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tAuth('fullName')} htmlFor="editFullName">
              <Input
                id="editFullName"
                name="editFullName"
                defaultValue={editing.user.fullName}
                required
                minLength={2}
              />
            </Field>
            <Field label={tAuth('preferredLanguage')} htmlFor="editLanguage">
              <Select
                id="editLanguage"
                name="editLanguage"
                defaultValue={editing.user.preferredLanguage}
              >
                {LOCALES.map((value) => (
                  <option key={value} value={value}>
                    {LOCALE_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label={t('reason')} htmlFor="profileReason">
            <Input id="profileReason" name="profileReason" required minLength={3} maxLength={500} />
          </Field>

          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {t('save')}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      ) : null}

      {handedOver ? (
        <Alert tone="success">
          <span data-testid="handed-over">
            {t('handedOver', { email: handedOver.email, password: handedOver.password })}
          </span>
        </Alert>
      ) : null}

      <p className="text-muted text-xs">{t('selfNote')}</p>
    </div>
  );
}

/**
 * A temporary password worth suggesting: long enough, and mixed enough to pass
 * the same rule the server applies. It is only ever read once, by the person
 * who hands it over.
 */
function temporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
  const digits = '23456789';
  const pick = (from: string, count: number) =>
    Array.from(crypto.getRandomValues(new Uint32Array(count)))
      .map((value) => from[value % from.length])
      .join('');
  return `${pick(alphabet, 8)}${pick(digits, 3)}`;
}

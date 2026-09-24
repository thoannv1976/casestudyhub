import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getSessionUser } from '@casestudyhub/core/auth/session';
import { Alert } from '@/components/ui/form';
import { ChangePasswordForm } from './change-password-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'password' });
  return { title: t('title') };
}

/**
 * Lives outside the protected layout on purpose: that layout sends anyone with
 * a temporary password here, and a page inside it would redirect to itself.
 */
export default async function ChangePasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getSessionUser();
  if (!user) redirect(`/${locale}/login`);

  const t = await getTranslations('password');

  return (
    <main id="main-content" className="mx-auto w-full max-w-md px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-muted mt-2 text-sm">{t('subtitle')}</p>

      {user.mustChangePassword ? (
        <div className="mt-6">
          <Alert tone="error">{t('temporaryPasswordNotice')}</Alert>
        </div>
      ) : null}

      <div className="surface-card mt-6 rounded-xl p-6">
        <ChangePasswordForm email={user.email} />
      </div>
    </main>
  );
}

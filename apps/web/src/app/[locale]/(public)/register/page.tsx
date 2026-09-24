import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getSystemSettings } from '@casestudyhub/core';
import { getSessionUser } from '@casestudyhub/core/auth/session';
import { Alert } from '@/components/ui/form';
import { Link } from '@/i18n/navigation';
import { RegisterForm } from './register-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('registerTitle') };
}

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (await getSessionUser()) redirect(`/${locale}/dashboard`);

  const t = await getTranslations('auth');
  const tError = await getTranslations('errors');
  const { registrationOpen } = await getSystemSettings();

  return (
    <main id="main-content" className="mx-auto w-full max-w-md px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('registerTitle')}</h1>
      <p className="text-muted mt-2 text-sm">{t('registerSubtitle')}</p>

      {/* The form is not merely disabled: a closed door with no form behind it
          is clearer than a form that refuses on submit. */}
      {registrationOpen ? (
        <div className="surface-card mt-8 rounded-xl p-6">
          <RegisterForm />
        </div>
      ) : (
        <div className="mt-8">
          <Alert tone="error">{tError('registrationClosed')}</Alert>
        </div>
      )}

      <p className="text-muted mt-6 text-center text-sm">
        {t('haveAccount')}{' '}
        <Link href="/login" className="text-brand-600 dark:text-brand-300 font-medium underline">
          {t('goSignIn')}
        </Link>
      </p>
    </main>
  );
}

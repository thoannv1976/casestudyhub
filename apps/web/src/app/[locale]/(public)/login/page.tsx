import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getSessionUser } from '@casestudyhub/core/auth/session';
import { Link } from '@/i18n/navigation';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('signInTitle') };
}

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Someone already signed in has no business on the sign-in page.
  if (await getSessionUser()) redirect(`/${locale}/dashboard`);

  const t = await getTranslations('auth');

  return (
    <main id="main-content" className="mx-auto w-full max-w-md px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('signInTitle')}</h1>
      <p className="text-muted mt-2 text-sm">{t('signInSubtitle')}</p>

      <div className="surface-card mt-8 rounded-xl p-6">
        <LoginForm />
      </div>

      <p className="text-muted mt-6 text-center text-sm">
        {t('noAccount')}{' '}
        <Link href="/register" className="text-brand-600 dark:text-brand-300 font-medium underline">
          {t('goRegister')}
        </Link>
      </p>
    </main>
  );
}

import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LtiLaunch } from './lti-launch';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'lti' });
  return { title: t('launchTitle') };
}

/**
 * Where UniGame Hub sends a person opening the platform from Moodle. The
 * ticket travels in the URL fragment, which never reaches a server log; the
 * client below reads it and posts it.
 */
export default async function LtiLaunchPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('lti');

  return (
    <main id="main-content" className="mx-auto w-full max-w-md px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('launchTitle')}</h1>
      <div className="surface-card mt-8 rounded-xl p-6">
        <LtiLaunch locale={locale} />
      </div>
    </main>
  );
}

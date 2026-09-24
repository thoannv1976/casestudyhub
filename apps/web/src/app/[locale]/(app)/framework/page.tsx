import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { hasPermission } from '@casestudyhub/shared';
import { listPolicies } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Alert } from '@/components/ui/form';
import { FrameworkEditor } from './framework-editor';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'framework' });
  return { title: t('title') };
}

/**
 * The assessment framework, as something a faculty can change.
 *
 * Every academic rule of the Presentation Guide was already data rather than a
 * constant buried in a feature - but it was a constant in the source, so
 * changing a threshold needed a developer. This is where it changes instead.
 *
 * Nothing here edits a version. A change publishes a new one, and classes keep
 * the version they were created under, so no mark already given can move.
 */
export default async function FrameworkPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const t = await getTranslations('framework');

  // Checked on the server, not by hiding the link: a student who types the
  // address gets the refusal, not the page.
  if (!hasPermission(user.role, 'policy.author')) {
    const tError = await getTranslations('errors');
    return (
      <div className="max-w-xl">
        <Alert tone="error">{tError('forbidden')}</Alert>
      </div>
    );
  }

  const policies = await listPolicies();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted mt-2 max-w-3xl text-sm leading-relaxed">{t('subtitle')}</p>
      </div>

      <FrameworkEditor policies={policies} canVersionShared={user.role === 'admin'} />
    </div>
  );
}

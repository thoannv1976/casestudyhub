import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Alert } from '@/components/ui/form';
import { Card, CardBody, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('title') };
}

export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const t = await getTranslations('admin');

  // Checked here on the server, not by hiding the link: a student who types
  // the address gets the refusal, not the page.
  if (user.role !== 'admin') {
    const tError = await getTranslations('errors');
    return (
      <div className="max-w-xl">
        <Alert tone="error">{tError('forbidden')}</Alert>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted mt-2 text-sm">{t('subtitle')}</p>
      </div>

      <Card>
        <CardTitle>{t('signedInAs')}</CardTitle>
        <CardBody>{user.email}</CardBody>
      </Card>

      <Card>
        <CardBody>{t('usersSoon')}</CardBody>
      </Card>
    </div>
  );
}

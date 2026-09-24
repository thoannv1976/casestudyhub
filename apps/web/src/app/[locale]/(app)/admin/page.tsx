import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Card, CardBody, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { Link } from '@/i18n/navigation';

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

      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/admin/users" className="block">
          <Card className="hover:border-brand-400 h-full transition-colors">
            <CardTitle>{t('usersTitle')}</CardTitle>
            <CardBody>{t('usersBody')}</CardBody>
          </Card>
        </Link>
        <Link href="/admin/academic" className="block">
          <Card className="hover:border-brand-400 h-full transition-colors">
            <CardTitle>{t('academicTitle')}</CardTitle>
            <CardBody>{t('academicBody')}</CardBody>
          </Card>
        </Link>
        <Link href="/admin/system" className="block">
          <Card className="hover:border-brand-400 h-full transition-colors">
            <CardTitle>{t('systemTitle')}</CardTitle>
            <CardBody>{t('systemBody')}</CardBody>
          </Card>
        </Link>
      </div>
    </div>
  );
}

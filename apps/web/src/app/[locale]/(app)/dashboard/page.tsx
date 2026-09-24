import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getUserProfile } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Badge, Card, CardBody, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'nav' });
  return { title: t('dashboard') };
}

const ROLE_LABEL_KEY = {
  admin: 'roleAdmin',
  lecturer: 'roleLecturer',
  student: 'roleStudent',
} as const;

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const profile = await getUserProfile(user.uid);

  const t = await getTranslations('dashboard');

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('welcome', { name: profile?.fullName ?? user.email })}
        </h1>
        <Badge tone="brand">{t(ROLE_LABEL_KEY[user.role])}</Badge>
      </div>

      <Card>
        <CardTitle>{t('yourAccount')}</CardTitle>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Email</dt>
            <dd className="font-medium">{profile?.email ?? user.email}</dd>
          </div>
          {profile?.studentId ? (
            <div>
              <dt className="text-muted">ID</dt>
              <dd className="font-medium">{profile.studentId}</dd>
            </div>
          ) : null}
        </dl>
      </Card>

      <Card>
        <CardTitle>{t('nextSteps')}</CardTitle>
        <CardBody>{t('phase1Note')}</CardBody>
      </Card>
    </div>
  );
}

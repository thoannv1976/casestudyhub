import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getUserProfile } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Badge, Card } from '@/components/ui/card';
import { ProfileForm } from './profile-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'profile' });
  return { title: t('title') };
}

const STATUS_LABEL_KEY = {
  active: 'statusActive',
  suspended: 'statusSuspended',
  pending: 'statusPending',
} as const;

const ROLE_LABEL_KEY = {
  admin: 'roleAdmin',
  lecturer: 'roleLecturer',
  student: 'roleStudent',
} as const;

export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const profile = await getUserProfile(user.uid);

  const t = await getTranslations('profile');
  const tAuth = await getTranslations('auth');
  const tDashboard = await getTranslations('dashboard');

  return (
    <div className="max-w-xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted mt-2 text-sm">{t('subtitle')}</p>
      </div>

      <Card>
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Email</dt>
            <dd className="font-medium">{profile?.email ?? user.email}</dd>
          </div>
          {profile?.studentId ? (
            <div>
              <dt className="text-muted">{tAuth('studentId')}</dt>
              <dd className="font-medium">{profile.studentId}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-muted">{t('role')}</dt>
            <dd className="mt-1">
              <Badge tone="brand">{tDashboard(ROLE_LABEL_KEY[user.role])}</Badge>
            </dd>
          </div>
          <div>
            <dt className="text-muted">{t('status')}</dt>
            <dd className="mt-1">
              <Badge>{t(STATUS_LABEL_KEY[profile?.status ?? 'active'])}</Badge>
            </dd>
          </div>
        </dl>
      </Card>

      <Card>
        <ProfileForm
          initialFullName={profile?.fullName ?? ''}
          initialLanguage={profile?.preferredLanguage ?? 'vi'}
        />
      </Card>
    </div>
  );
}

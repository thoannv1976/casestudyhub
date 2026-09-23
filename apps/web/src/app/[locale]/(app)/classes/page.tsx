import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getClassById, listClassesOfStudent } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Badge, Card, CardBody, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { JoinClassForm } from './join-class-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'nav' });
  return { title: t('myClasses') };
}

export default async function MyClassesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const enrollments = await listClassesOfStudent(user.uid);
  const classes = await Promise.all(
    enrollments.map(async (enrollment) => ({
      enrollment,
      details: await getClassById(enrollment.classId),
    })),
  );

  const t = await getTranslations('classes');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted mt-2 text-sm">{t('subtitle')}</p>
      </div>

      <Card>
        <CardTitle>{t('joinTitle')}</CardTitle>
        <div className="mt-4 max-w-sm">
          <JoinClassForm />
        </div>
      </Card>

      {classes.length === 0 ? (
        <Card>
          <CardBody>{t('empty')}</CardBody>
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {classes.map(({ enrollment, details }) => (
            <li key={enrollment.id}>
              <Link href={`/classes/${enrollment.classId}`} className="block h-full">
                <Card className="hover:border-brand-400 h-full transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle>{details?.className ?? enrollment.classId}</CardTitle>
                    <Badge tone={enrollment.status === 'active' ? 'brand' : 'neutral'}>
                      {enrollment.status === 'active' ? t('statusActive') : t('statusPending')}
                    </Badge>
                  </div>
                  <dl className="mt-4 space-y-1 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">{t('classCode')}</dt>
                      <dd className="font-mono font-medium">{details?.classCode ?? '—'}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">{t('studentId')}</dt>
                      <dd className="font-medium">{enrollment.studentId}</dd>
                    </div>
                  </dl>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

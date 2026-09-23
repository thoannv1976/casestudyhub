import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { listAcademicYears, listCourses, listSemesters } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Card, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { AcademicAdmin } from './academic-admin';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'academicAdmin' });
  return { title: t('title') };
}

export default async function AcademicAdminPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const t = await getTranslations('academicAdmin');

  if (user.role !== 'admin') {
    const tError = await getTranslations('errors');
    return <Alert tone="error">{tError('forbidden')}</Alert>;
  }

  const [years, semesters, courses] = await Promise.all([
    listAcademicYears(),
    listSemesters(),
    listCourses(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted mt-2 text-sm">{t('subtitle')}</p>
      </div>

      <Card>
        <AcademicAdmin years={years} semesters={semesters} />
      </Card>

      <Card>
        <CardTitle>{t('coursesTitle')}</CardTitle>
        {courses.length === 0 ? (
          <p className="text-muted mt-2 text-sm">{t('noCourses')}</p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {courses.map((course) => (
              <li key={course.id}>{course.name}</li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

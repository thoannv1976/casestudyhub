import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  listAllClasses,
  listClassesOfLecturer,
  listCourses,
  listSemesters,
} from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Badge, Card, CardBody, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { Link } from '@/i18n/navigation';
import { CreateClassForm } from './create-class-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'nav' });
  return { title: t('teaching') };
}

export default async function TeachingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const t = await getTranslations('teaching');
  const tError = await getTranslations('errors');

  if (user.role !== 'lecturer' && user.role !== 'admin') {
    return <Alert tone="error">{tError('forbidden')}</Alert>;
  }

  const [classes, courses, semesters] = await Promise.all([
    user.role === 'admin' ? listAllClasses() : listClassesOfLecturer(user.uid),
    listCourses(),
    listSemesters(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted mt-2 text-sm">{t('subtitle')}</p>
      </div>

      <Card>
        <CardTitle>{t('createClass')}</CardTitle>
        <div className="mt-4">
          <CreateClassForm courses={courses} semesters={semesters} />
        </div>
      </Card>

      {classes.length === 0 ? (
        <Card>
          <CardBody>{t('empty')}</CardBody>
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {classes.map((item) => (
            <li key={item.id}>
              <Link href={`/teaching/${item.id}`} className="block h-full">
                <Card className="hover:border-brand-400 h-full transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle>{item.className}</CardTitle>
                    <Badge tone={item.status === 'active' ? 'brand' : 'neutral'}>
                      {item.studentCount} {t('studentsShort')}
                    </Badge>
                  </div>
                  <p className="text-muted mt-3 font-mono text-sm">{item.classCode}</p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

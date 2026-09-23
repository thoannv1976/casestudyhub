import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { listCases, listCourses } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { CaseLibrary } from './case-library';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'cases' });
  return { title: t('title') };
}

export default async function CaseLibraryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const canEdit = user.role === 'lecturer' || user.role === 'admin';

  const [cases, courses] = await Promise.all([
    listCases({ publishedOnly: !canEdit }),
    canEdit ? listCourses() : Promise.resolve([]),
  ]);

  const t = await getTranslations('cases');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted mt-2 text-sm">{canEdit ? t('subtitle') : t('subtitleStudent')}</p>
      </div>

      <CaseLibrary cases={cases} courses={courses} canEdit={canEdit} />
    </div>
  );
}

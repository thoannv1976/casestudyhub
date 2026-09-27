import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { assertCanManageClass, classOverview, getClassById } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Alert } from '@/components/ui/form';
import { OverviewTable } from './overview-table';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Class overview' };

/**
 * Where a class stands, in one table.
 *
 * Read-only, and computed on the server: it needs the framework each piece of
 * work froze, the draft marks and the published grades, none of which a
 * browser may read.
 */
export default async function ClassOverviewPage({
  params,
}: {
  params: Promise<{ locale: string; classId: string }>;
}) {
  const { locale, classId } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const t = await getTranslations('overview');
  const tError = await getTranslations('errors');

  if (user.role !== 'lecturer' && user.role !== 'admin') {
    return <Alert tone="error">{tError('forbidden')}</Alert>;
  }

  try {
    await assertCanManageClass(user, classId);
  } catch {
    return <Alert tone="error">{tError('notYourClass')}</Alert>;
  }

  const details = await getClassById(classId);
  if (!details) notFound();

  const overview = await classOverview(classId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-muted mt-2 max-w-3xl text-sm leading-relaxed">{t('subtitle')}</p>
          <p className="text-muted mt-1 font-mono text-xs">{details.classCode}</p>
        </div>
        <a
          href={`/api/classes/${classId}/overview?format=csv`}
          className="text-brand-600 dark:text-brand-300 text-sm font-medium underline"
        >
          {t('download')}
        </a>
      </div>

      <OverviewTable classId={classId} overview={overview} />
    </div>
  );
}

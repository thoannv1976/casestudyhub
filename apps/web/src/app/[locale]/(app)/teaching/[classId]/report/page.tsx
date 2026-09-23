import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { assertCanManageClass, classReport } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Class report' };

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * The class report (SRS Module 14).
 *
 * Everything here is read from marks that already exist; nothing on this page
 * computes or changes one. Two honesty notes are part of the report rather
 * than footnotes to it: the distribution counts published grades only, and the
 * CLO mapping is the rubric's illustrative one until the faculty confirms it
 * against the syllabus.
 */
export default async function ClassReportPage({
  params,
}: {
  params: Promise<{ locale: string; classId: string }>;
}) {
  const { locale, classId } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const t = await getTranslations('report');
  const tRubric = await getTranslations('rubric');
  const tError = await getTranslations('errors');

  if (user.role !== 'lecturer' && user.role !== 'admin') {
    return <Alert tone="error">{tError('forbidden')}</Alert>;
  }

  try {
    await assertCanManageClass(user, classId);
  } catch {
    return <Alert tone="error">{tError('notYourClass')}</Alert>;
  }

  const report = await classReport(classId);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{report.className}</h1>
          <p className="text-muted mt-2 font-mono text-sm">{report.classCode}</p>
        </div>
        <a
          className="text-brand-600 dark:text-brand-300 text-sm font-medium underline"
          href={`/api/classes/${classId}/report`}
        >
          {t('download')}
        </a>
      </div>

      <Card>
        <CardTitle>{t('gradesTitle')}</CardTitle>
        <p className="text-muted mt-2 text-sm">{t('publishedOnly')}</p>

        {report.hasUnpublishedMarking ? (
          <Alert tone="error">{t('unpublishedWarning')}</Alert>
        ) : null}

        {report.distribution.count === 0 ? (
          <p className="text-muted mt-4 text-sm">{t('noGrades')}</p>
        ) : (
          <>
            <p className="mt-4 text-sm">
              {t('gradesSummary', {
                count: report.distribution.count,
                mean: report.distribution.mean.toFixed(1),
                median: report.distribution.median.toFixed(1),
                lowest: report.distribution.lowest,
                highest: report.distribution.highest,
              })}
            </p>
            <ul className="mt-3 space-y-2">
              {report.distribution.rows.map((row) => (
                <li key={row.key} className="text-sm">
                  <div className="flex justify-between">
                    <span>{t(`bands.${row.key}`)}</span>
                    <span className="tabular-nums">
                      {row.count} · {percent(row.share)}
                    </span>
                  </div>
                  <div
                    className="bg-brand-500 mt-1 h-2 rounded-full"
                    style={{ width: `${Math.max(row.share * 100, row.count > 0 ? 2 : 0)}%` }}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card>
        <CardTitle>{t('criteriaTitle')}</CardTitle>
        <p className="text-muted mt-2 text-sm">{t('criteriaHint')}</p>
        <ul className="mt-4 space-y-1 text-sm">
          {report.criteria.map((row) => (
            <li key={row.criterionId} className="flex flex-wrap justify-between gap-2">
              <span>{tRubric(`criteria.${row.criterionId}`)}</span>
              <span className="tabular-nums">
                {row.mean.toFixed(1)} / {row.maxPoints}
                <span className="text-muted ml-2 text-xs">{percent(row.meanShare)}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle>{t('cloTitle')}</CardTitle>
        <Alert tone="error">{t('cloCaveat')}</Alert>
        <p className="text-muted mt-3 text-sm">
          {t('cloThreshold', { threshold: percent(report.cloThreshold) })}
        </p>
        <ul className="mt-4 space-y-2 text-sm">
          {report.clos.map((clo) => (
            <li key={clo.cloId} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">{clo.cloId}</span>
                <span className="text-muted ml-2 text-xs">
                  {clo.criterionIds
                    .map((criterionId) => tRubric(`criteria.${criterionId}`))
                    .join(' · ')}
                </span>
              </span>
              <span className="tabular-nums">
                {clo.count === 0 ? t('noData') : percent(clo.attainment)}
                {clo.count > 0 ? (
                  <span className="text-muted ml-2 text-xs">
                    {t('cloMet', { share: percent(clo.atOrAboveThreshold) })}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle>{t('participationTitle')}</CardTitle>
        <ul className="mt-3 space-y-1 text-sm">
          <li>
            {t('asked', {
              count: report.participation.asked,
              total: report.participation.enrolled,
            })}
          </li>
          <li>
            {t('answered', {
              count: report.participation.answered,
              total: report.participation.enrolled,
            })}
          </li>
          <li>
            {t('scored', {
              count: report.participation.scored,
              total: report.participation.enrolled,
            })}
          </li>
        </ul>
        {report.participation.silentUids.length > 0 ? (
          <p className="mt-3 text-sm">
            <Badge>{t('silent', { count: report.participation.silentUids.length })}</Badge>
            <span className="text-muted ml-2 text-xs">{t('silentHint')}</span>
          </p>
        ) : null}
      </Card>
    </div>
  );
}

import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { aiStatus, getSystemSettings, platformMetrics } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Card, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { AiProbePanel } from './ai-probe';
import { SystemSettingsForm } from './system-settings-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'systemAdmin' });
  return { title: t('title') };
}

/**
 * What the platform holds, and the few switches that change how it behaves
 * (SRS Module 03).
 *
 * Only settings something reads are offered. A switch that changes nothing is
 * worse than no switch: it tells whoever flips it that they have done
 * something.
 */
export default async function SystemPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const t = await getTranslations('systemAdmin');

  if (user.role !== 'admin') {
    const tError = await getTranslations('errors');
    return (
      <div className="max-w-xl">
        <Alert tone="error">{tError('forbidden')}</Alert>
      </div>
    );
  }

  const [metrics, settings] = await Promise.all([platformMetrics(), getSystemSettings()]);

  const counts = [
    { key: 'students', value: metrics.users.student },
    { key: 'lecturers', value: metrics.users.lecturer },
    { key: 'admins', value: metrics.users.admin },
    { key: 'suspended', value: metrics.users.suspended },
    { key: 'activeClasses', value: metrics.classes.active },
    { key: 'liveSessions', value: metrics.sessions.live },
    { key: 'completedSessions', value: metrics.sessions.completed },
    { key: 'submissions', value: metrics.submissions },
    { key: 'publishedGrades', value: metrics.grades.published },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted mt-2 max-w-3xl text-sm leading-relaxed">{t('subtitle')}</p>
      </div>

      <Card>
        <CardTitle>{t('metricsTitle')}</CardTitle>
        <ul
          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="platform-metrics"
        >
          {counts.map((item) => (
            <li key={item.key} className="surface-card rounded-xl p-4">
              <p className="text-2xl font-semibold tabular-nums">{item.value}</p>
              <p className="text-muted mt-1 text-sm">{t(`counts.${item.key}`)}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle>{t('aiTitle')}</CardTitle>
        <p className="text-muted mt-2 text-sm">{t('aiBody', { period: metrics.ai.period })}</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3" data-testid="ai-usage">
          <li className="surface-card rounded-xl p-4">
            <p className="text-2xl font-semibold tabular-nums">
              {metrics.ai.calls}
              <span className="text-muted text-base"> / {metrics.ai.budget}</span>
            </p>
            <p className="text-muted mt-1 text-sm">{t('aiCalls')}</p>
          </li>
          <li className="surface-card rounded-xl p-4">
            <p className="text-2xl font-semibold tabular-nums">
              {metrics.ai.promptTokens.toLocaleString(locale)}
            </p>
            <p className="text-muted mt-1 text-sm">{t('aiPromptTokens')}</p>
          </li>
          <li className="surface-card rounded-xl p-4">
            <p className="text-2xl font-semibold tabular-nums">
              {metrics.ai.outputTokens.toLocaleString(locale)}
            </p>
            <p className="text-muted mt-1 text-sm">{t('aiOutputTokens')}</p>
          </li>
        </ul>
        {metrics.ai.calls >= metrics.ai.budget ? (
          <div className="mt-4">
            <Alert tone="error">{t('aiBudgetSpent')}</Alert>
          </div>
        ) : null}
      </Card>

      <AiProbePanel status={aiStatus()} />

      <SystemSettingsForm settings={settings} />
    </div>
  );
}

import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  DEFAULT_PRESENTATION_POLICY,
  aiAssessableMaxPoints,
  type PresentationRole,
} from '@casestudyhub/shared';
import { Badge, Card, CardBody, CardTitle, Section } from '@/components/ui/card';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Link } from '@/i18n/navigation';
import { getSessionUser } from '@casestudyhub/core/auth/session';

const policy = DEFAULT_PRESENTATION_POLICY;

// The header shows either "sign in" or "dashboard", so this page is rendered
// per request rather than prebuilt.
export const dynamic = 'force-dynamic';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // A signed-in visitor gets a way straight back into their own work.
  const user = await getSessionUser();

  const t = await getTranslations('landing');
  const tApp = await getTranslations('app');
  const tCommon = await getTranslations('common');
  const tPolicy = await getTranslations('policy');
  const tRoles = await getTranslations('roles');
  const tRubric = await getTranslations('rubric');
  const tNav = await getTranslations('nav');

  const range = (min: number, max: number) => tPolicy('range', { min, max });

  const formatRows: { label: string; value: string }[] = [
    {
      label: tPolicy('groupSize'),
      value: `${range(policy.groupSize.min, policy.groupSize.max)} ${tCommon('students')}`,
    },
    {
      label: tPolicy('presentationTime'),
      value: `${range(policy.presentation.minMinutes, policy.presentation.maxMinutes)} ${tCommon('minutes')}`,
    },
    {
      label: tPolicy('qaTime'),
      value: `${range(policy.qa.minMinutes, policy.qa.maxMinutes)} ${tCommon('minutes')}`,
    },
    {
      label: tPolicy('slideCount'),
      value: `${range(policy.slides.min, policy.slides.max)} ${tCommon('slides')}`,
    },
    {
      label: tPolicy('deadline'),
      value: tPolicy('deadlineValue', { hours: policy.submission.deadlineHoursBeforeSession }),
    },
    {
      label: tPolicy('marking'),
      value: tPolicy('markingValue', {
        team: policy.grading.teamWeight * 100,
        individual: policy.grading.individualWeight * 100,
      }),
    },
  ];

  const phases = [
    { key: 'phase1', body: 'phase1Body', tone: 'brand' as const, status: tCommon('inProgress') },
    { key: 'phase2', body: 'phase2Body', tone: 'neutral' as const, status: tCommon('comingSoon') },
    { key: 'phase3', body: 'phase3Body', tone: 'neutral' as const, status: tCommon('comingSoon') },
    { key: 'phase4', body: 'phase4Body', tone: 'neutral' as const, status: tCommon('comingSoon') },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-[var(--border-subtle)] bg-[var(--surface)]/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="bg-brand-600 flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white"
            >
              CH
            </span>
            <span className="font-semibold">{tApp('name')}</span>
          </div>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <ThemeToggle />
            {user ? (
              <Link
                href="/dashboard"
                className="bg-brand-600 hover:bg-brand-700 inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-white transition-colors"
              >
                {tNav('dashboard')}
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="surface-card hover:border-brand-400 hidden h-9 items-center rounded-full px-4 text-sm font-medium transition-colors sm:inline-flex"
                >
                  {tCommon('signIn')}
                </Link>
                <Link
                  href="/register"
                  className="bg-brand-600 hover:bg-brand-700 inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-white transition-colors"
                >
                  {tCommon('register')}
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="bg-[var(--surface-muted)]">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
            <Badge tone="brand">{tApp('fullName')}</Badge>
            <h1 className="mt-5 max-w-4xl text-3xl font-semibold tracking-tight sm:text-5xl">
              {t('heroTitle')}
            </h1>
            <p className="text-muted mt-5 max-w-3xl text-base leading-relaxed">
              {t('heroSubtitle')}
            </p>
            <p className="text-muted mt-6 text-sm italic">{t('heroNote')}</p>
          </div>
        </div>

        <Section id="pillars" title={t('pillarsTitle')}>
          <div className="grid gap-4 md:grid-cols-3">
            {([1, 2, 3] as const).map((n) => (
              <Card key={n}>
                <CardTitle>{t(`pillar${n}Title`)}</CardTitle>
                <CardBody>{t(`pillar${n}Body`)}</CardBody>
              </Card>
            ))}
          </div>
        </Section>

        <Section id="framework" title={t('frameworkTitle')} subtitle={t('frameworkSubtitle')}>
          <div className="surface-card overflow-hidden rounded-xl">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{tPolicy('ecom2026Standard')}</caption>
              <tbody>
                {formatRows.map((row, index) => (
                  <tr
                    key={row.label}
                    className={index > 0 ? 'border-t border-[var(--border-subtle)]' : undefined}
                  >
                    <th scope="row" className="text-muted w-1/2 px-4 py-3 font-medium">
                      {row.label}
                    </th>
                    <td className="px-4 py-3 font-semibold">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="roles" title={t('rolesTitle')} subtitle={t('rolesSubtitle')}>
          <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {policy.roles.map((role: PresentationRole) => (
              <li key={role.id}>
                <Card className="h-full">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone="accent">{role.id}</Badge>
                    <span className="text-muted text-xs">
                      {role.minutes} {tCommon('minutes')}
                    </span>
                  </div>
                  <div className="mt-3">
                    <CardTitle>{tRoles(`${role.key}.title`)}</CardTitle>
                    <CardBody>{tRoles(`${role.key}.presents`)}</CardBody>
                    <p className="border-brand-300 mt-3 border-l-2 pl-3 text-sm italic">
                      {tRoles(`${role.key}.mustAnswer`)}
                    </p>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="rubric" title={t('rubricTitle')} subtitle={t('rubricSubtitle')}>
          <div className="surface-card overflow-x-auto rounded-xl">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">{tRubric('standard100')}</caption>
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {tRubric('standard100')}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    {tCommon('points')}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">
                    {t('rubricAiColumn')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {policy.rubric.criteria.map((criterion) => (
                  <tr key={criterion.id} className="border-b border-[var(--border-subtle)]">
                    <th scope="row" className="px-4 py-3 font-normal">
                      {tRubric(`criteria.${criterion.id}`)}
                    </th>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {criterion.maxPoints}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {criterion.aiAssessable ? (
                        <span aria-hidden="true">✓</span>
                      ) : (
                        <Badge>{t('rubricLecturerOnly')}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="px-4 py-3 text-right font-semibold">
                    Σ
                  </th>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {policy.rubric.totalPoints}
                  </td>
                  <td className="text-muted px-4 py-3 text-right text-xs tabular-nums">
                    {aiAssessableMaxPoints(policy.rubric)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="roadmap" title={t('roadmapTitle')}>
          <ol className="grid gap-4 md:grid-cols-2">
            {phases.map((phase) => (
              <li key={phase.key}>
                <Card className="h-full">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle>{t(phase.key)}</CardTitle>
                    <Badge tone={phase.tone}>{phase.status}</Badge>
                  </div>
                  <CardBody>{t(phase.body)}</CardBody>
                </Card>
              </li>
            ))}
          </ol>
        </Section>
      </main>

      <footer className="border-t border-[var(--border-subtle)]">
        <div className="text-muted mx-auto w-full max-w-6xl px-4 py-8 text-sm sm:px-6">
          <p>
            {tApp('name')} · {tApp('tagline')}
          </p>
          <p className="mt-2">
            {tPolicy('ecom2026Standard')} · v{policy.version}
          </p>
        </div>
      </footer>
    </div>
  );
}

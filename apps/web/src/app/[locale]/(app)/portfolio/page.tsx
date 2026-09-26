import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { roleKeyOf } from '@casestudyhub/shared';
import { studentPortfolio } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Badge, Card, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Portfolio' };

/**
 * A student's own record, across every class (SRS Module 14.3).
 *
 * Contribution as well as marks: the roles carried, the questions asked, the
 * ones answered in the room, the groups scored. A student who took no part all
 * semester sees that plainly here, which is the point of showing it at all.
 *
 * Only published grades appear. A draft is the lecturer's working note.
 */
export default async function PortfolioPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const t = await getTranslations('portfolio');
  const tRoles = await getTranslations('roles');
  const tProject = await getTranslations('project');

  const portfolio = await studentPortfolio(user.uid);
  const { totals } = portfolio;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted mt-2 text-sm">{t('subtitle')}</p>
      </div>

      <Card>
        <CardTitle>{t('contributionTitle')}</CardTitle>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { key: 'classes', value: totals.classes },
            { key: 'asked', value: totals.questionsAsked },
            { key: 'answered', value: totals.questionsAnsweredAloud },
            { key: 'scored', value: totals.peerScoresGiven },
          ].map((item) => (
            <li key={item.key} className="surface-card rounded-xl p-4">
              <p className="text-2xl font-semibold tabular-nums">{item.value}</p>
              <p className="text-muted mt-1 text-sm">{t(`counts.${item.key}`)}</p>
            </li>
          ))}
        </ul>

        {totals.rolesHeld.length > 0 ? (
          <p className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">{t('rolesHeld')}</span>
            {totals.rolesHeld.map((roleId) => (
              <Badge key={roleId} tone="accent">
                {roleId} · {tRoles(`${roleKeyOf(roleId)}.title`)}
              </Badge>
            ))}
          </p>
        ) : null}

        {totals.questionsAsked === 0 &&
        totals.questionsAnsweredAloud === 0 &&
        totals.peerScoresGiven === 0 ? (
          <p className="text-muted mt-4 text-sm">{t('nothingYet')}</p>
        ) : null}
      </Card>

      <div className="space-y-4">
        {portfolio.entries.length === 0 ? (
          <p className="text-muted text-sm">{t('noClasses')}</p>
        ) : (
          portfolio.entries.map((entry) => (
            <Card key={entry.classId}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>{entry.className}</CardTitle>
                  <p className="text-muted mt-1 font-mono text-xs">{entry.classCode}</p>
                  {entry.caseTitle ? (
                    <p className="mt-2 text-sm">
                      {entry.groupName ? `${entry.groupName} · ` : ''}
                      {entry.caseTitle}
                    </p>
                  ) : null}
                </div>

                {entry.finalScore === null && entry.projectFinalScore === null ? (
                  <Badge>{t('notPublished')}</Badge>
                ) : (
                  <div className="flex flex-wrap items-start gap-6 text-right">
                    {entry.finalScore === null ? null : (
                      <div>
                        <p className="text-2xl font-semibold tabular-nums">{entry.finalScore}</p>
                        <p className="text-muted text-xs">
                          {t('breakdown', {
                            group: entry.groupScore ?? 0,
                            individual: entry.individualScore ?? 0,
                          })}
                        </p>
                      </div>
                    )}
                    {/* Two marks, for two different pieces of work. Showing one
                        where a student earned both would be a quiet lie. */}
                    {entry.projectFinalScore === null ? null : (
                      <div>
                        <p className="text-2xl font-semibold tabular-nums">
                          {entry.projectFinalScore}
                        </p>
                        <p className="text-muted text-xs">{tProject('subject')}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <ul className="mt-4 flex flex-wrap gap-2 text-xs">
                {entry.roleIds.map((roleId) => (
                  <li key={roleId}>
                    <Badge tone="accent">
                      {roleId} · {tRoles(`${roleKeyOf(roleId)}.title`)}
                    </Badge>
                  </li>
                ))}
                <li className="surface-card rounded-full px-3 py-1 tabular-nums">
                  {t('inClass.asked', { count: entry.questionsAsked })}
                </li>
                <li className="surface-card rounded-full px-3 py-1 tabular-nums">
                  {t('inClass.answered', { count: entry.questionsAnsweredAloud })}
                </li>
                <li className="surface-card rounded-full px-3 py-1 tabular-nums">
                  {t('inClass.scored', { count: entry.peerScoresGiven })}
                </li>
              </ul>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppError, getLtiPendingLink, isLtiEnabled, type LtiPendingLink } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Card, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { LtiLinkForm } from './link-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'lti' });
  return { title: t('linkTitle') };
}

/** A lecturer opened a Moodle course that is not linked yet: choose its class, once. */
export default async function LtiLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ key?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { key } = await searchParams;
  const user = await requireSessionUser();
  const t = await getTranslations('lti');
  const tAll = await getTranslations();

  if (!isLtiEnabled() || !key) return <Alert tone="error">{tAll('errors.ltiLinkExpired')}</Alert>;

  let pending: LtiPendingLink;
  try {
    pending = await getLtiPendingLink(user, key);
  } catch (error) {
    const messageKey = error instanceof AppError ? error.messageKey : 'errors.unexpected';
    return <Alert tone="error">{tAll(messageKey)}</Alert>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('linkTitle')}</h1>
      <Card>
        <CardTitle>{t('linkCourse', { course: pending.courseTitle })}</CardTitle>
        <p className="text-muted mt-2 text-sm">{t('linkHint')}</p>
        <div className="mt-4">
          {pending.classes.length === 0 ? (
            <Alert tone="error">{t('linkNoClasses')}</Alert>
          ) : (
            <LtiLinkForm
              linkKey={pending.key}
              classes={pending.classes.map((item) => ({
                id: item.id,
                // Enough to tell this cohort's class from last term's.
                label: `${item.className} · ${item.classCode} · ${t('linkClassFacts', {
                  students: item.studentCount,
                  deadline: item.caseSelectionDeadline
                    ? new Date(item.caseSelectionDeadline).toLocaleDateString(locale)
                    : '—',
                })}`,
              }))}
            />
          )}
        </div>
      </Card>
    </div>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  assertCanManageClass,
  availableAiProviders,
  defaultAiProviderName,
  getClassById,
  listCases,
  listClassQuestions,
  listGroups,
  listSessions,
  qaPolicyOfClass,
} from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Alert } from '@/components/ui/form';
import { Link } from '@/i18n/navigation';
import { QaReview, type QaSessionView } from './qa-review';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'qaReview' });
  return { title: t('title') };
}

/**
 * Every question of the class, presentation by presentation, with what the
 * group answered and what a model suggests - where the lecturer settles the
 * answer the class keeps, and marks the questions and answers worth keeping.
 */
export default async function ClassQuestionsPage({
  params,
}: {
  params: Promise<{ locale: string; classId: string }>;
}) {
  const { locale, classId } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const t = await getTranslations('qaReview');
  const tError = await getTranslations('errors');

  if (user.role !== 'lecturer' && user.role !== 'admin') {
    return <Alert tone="error">{tError('forbidden')}</Alert>;
  }
  const details = await getClassById(classId);
  if (!details) notFound();
  try {
    await assertCanManageClass(user, classId);
  } catch {
    return <Alert tone="error">{tError('notYourClass')}</Alert>;
  }

  const [sessions, groups, cases, questions, policy, providers, defaultProvider] =
    await Promise.all([
      listSessions(classId),
      listGroups(classId),
      listCases(),
      listClassQuestions(classId),
      qaPolicyOfClass(classId),
      availableAiProviders(),
      defaultAiProviderName(),
    ]);

  const groupName = new Map(groups.map((group) => [group.id, group.groupName]));
  const caseTitle = new Map(cases.map((study) => [study.id, `${study.caseCode} — ${study.title}`]));

  const views: QaSessionView[] = sessions
    .filter((session) => session.status !== 'scheduled')
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
    .map((session) => ({
      id: session.id,
      groupName: groupName.get(session.groupId) ?? session.groupId,
      subject: session.caseStudyId ? (caseTitle.get(session.caseStudyId) ?? '') : '',
      status: session.status,
      startedAt: session.startedAt ?? null,
      questions: questions.filter((question) => question.sessionId === session.id),
    }));

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/teaching/${classId}`}
          className="text-brand-600 dark:text-brand-300 text-sm font-medium underline"
        >
          ← {details.className}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted mt-2 text-sm">{t('subtitle')}</p>
      </div>

      <QaReview
        classId={classId}
        locale={locale}
        sessions={views}
        afterClassQa={policy.afterClassQa}
        providers={providers}
        defaultProvider={
          providers.includes(defaultProvider) ? defaultProvider : (providers[0] ?? null)
        }
      />
    </div>
  );
}

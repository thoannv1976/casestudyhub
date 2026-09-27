import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  aiIsAvailable,
  assertCanManageClass,
  findSessionForAssignment,
  getQuestionClusters,
  listGroups,
  listSessionQuestions,
  projectTarget,
  sessionAskers,
} from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Alert } from '@/components/ui/form';
import { Card } from '@/components/ui/card';
import { QuestionBoard } from './question-board';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Questions' };

/**
 * Every question the class asked one group's project presentation.
 *
 * Read-only, and computed on the server: it needs the class roster to know who
 * has not asked yet, and the room's own record of who said what.
 */
export default async function ProjectQuestionsPage({
  params,
}: {
  params: Promise<{ locale: string; classId: string; groupId: string }>;
}) {
  const { locale, classId, groupId } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const t = await getTranslations('questionBoard');
  const tError = await getTranslations('errors');

  if (user.role !== 'lecturer' && user.role !== 'admin') {
    return <Alert tone="error">{tError('forbidden')}</Alert>;
  }

  try {
    await assertCanManageClass(user, classId);
  } catch {
    return <Alert tone="error">{tError('notYourClass')}</Alert>;
  }

  const target = await projectTarget(classId, groupId);
  if (!target) notFound();

  const session = await findSessionForAssignment(target.id);
  if (!session) {
    return <Alert tone="error">{tError('sessionNotFound')}</Alert>;
  }

  const [groups, questions, askers, clusters, aiAvailable] = await Promise.all([
    listGroups(classId),
    listSessionQuestions(session.id),
    sessionAskers(session.id),
    getQuestionClusters(session.id),
    aiIsAvailable(),
  ]);

  const group = groups.find((candidate) => candidate.id === groupId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted mt-2 text-sm">{group?.groupName ?? groupId}</p>
      </div>

      <Card>
        <QuestionBoard
          sessionId={session.id}
          questions={questions}
          askers={askers}
          clusters={clusters}
          aiAvailable={aiAvailable}
        />
      </Card>
    </div>
  );
}

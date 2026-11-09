import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  assertCanManageClass,
  classParticipation,
  getClassById,
  isLtiEnabled,
  ltiLinksOfClass,
} from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Alert } from '@/components/ui/form';
import { Link } from '@/i18n/navigation';
import { ParticipationBoard } from './participation-board';
import { SendAttendanceToMoodle } from './send-attendance';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'participation' });
  return { title: t('title') };
}

/** Who took part in the class's presentations, and the attendance score that follows. */
export default async function ParticipationPage({
  params,
}: {
  params: Promise<{ locale: string; classId: string }>;
}) {
  const { locale, classId } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const t = await getTranslations('participation');
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

  const [data, moodle] = await Promise.all([
    classParticipation(classId),
    isLtiEnabled() ? ltiLinksOfClass(classId) : Promise.resolve(null),
  ]);
  const attendanceColumns =
    moodle?.activities.filter((activity) => activity.kind === 'attendance' && activity.hasColumn)
      .length ?? 0;

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

      {moodle && moodle.courses.length > 0 ? (
        <SendAttendanceToMoodle classId={classId} columns={attendanceColumns} />
      ) : null}

      <ParticipationBoard
        classId={classId}
        locale={locale}
        sessions={data.sessions.map((session) => ({
          id: session.id,
          groupName: session.groupName,
        }))}
        rows={data.rows.map(({ perSession, ...row }) => ({
          ...row,
          perSession: perSession.map((cell) =>
            !cell.eligible
              ? 'own'
              : cell.asked && cell.reviewed
                ? 'both'
                : cell.asked
                  ? 'asked'
                  : cell.reviewed
                    ? 'reviewed'
                    : 'none',
          ),
        }))}
        policy={data.policy}
      />
    </div>
  );
}

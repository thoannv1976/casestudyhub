import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { dashboardFor, getUserProfile } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'nav' });
  return { title: t('dashboard') };
}

const ROLE_LABEL_KEY = {
  admin: 'roleAdmin',
  lecturer: 'roleLecturer',
  student: 'roleStudent',
} as const;

/** The tone of a state, so the eye finds the overdue row before reading it. */
const STATE_TONE = {
  awaiting: 'neutral',
  overdue: 'accent',
  complete: 'brand',
  marked: 'brand',
  published: 'neutral',
} as const;

/**
 * What this person has to do next.
 *
 * Until now this page told everybody "Phase 1 is being built", which was
 * useless on the first day and untrue by the fourth phase. Nothing here is new
 * information - it is the same assignments, sessions and marks the other pages
 * read, sorted by what is still outstanding, which is the one thing a person
 * opening the app actually wants.
 */
export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const t = await getTranslations('dashboard');
  const tProgress = await getTranslations('progress');

  const [profile, board] = await Promise.all([getUserProfile(user.uid), dashboardFor(user)]);
  const isStaff = user.role === 'admin' || user.role === 'lecturer';

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('welcome', { name: profile?.fullName ?? user.email })}
        </h1>
        <Badge tone="brand">{t(ROLE_LABEL_KEY[user.role])}</Badge>
      </div>

      {board.live.length > 0 ? (
        <Card>
          <CardTitle>{t('liveNow')}</CardTitle>
          <ul className="mt-4 space-y-2 text-sm" data-testid="dashboard-live">
            {board.live.map((session) => (
              <li key={session.sessionId}>
                <Link
                  href={`/sessions/${session.sessionId}`}
                  className="text-brand-600 dark:text-brand-300 font-medium underline"
                >
                  {session.caseTitle}
                </Link>
                <span className="text-muted ml-2">
                  {session.groupName} · {session.className}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Somebody with no class owes nothing by definition, and saying so in
          two cards says it twice. The class card below carries that message. */}
      {board.classes.length > 0 ? (
        <Card>
          <CardTitle>{isStaff ? t('waitingOnYou') : t('yourWork')}</CardTitle>
          {board.outstanding.length === 0 ? (
            <p className="text-muted mt-3 text-sm">
              {isStaff ? t('nothingWaiting') : t('nothingDue')}
            </p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm" data-testid="dashboard-outstanding">
              {board.outstanding.map((row) => (
                <li
                  key={row.assignmentId}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
                >
                  <Badge tone={STATE_TONE[row.progress.state]}>
                    {tProgress(row.progress.state)}
                  </Badge>
                  <Link
                    href={
                      isStaff
                        ? `/teaching/${row.classId}/grade/${row.assignmentId}`
                        : `/classes/${row.classId}`
                    }
                    className="font-medium underline"
                  >
                    {row.caseTitle}
                  </Link>
                  <span className="text-muted">
                    {isStaff ? `${row.groupName} · ${row.className}` : row.className}
                  </span>
                  {row.progress.missing > 0 ? (
                    <span className="text-muted">
                      {tProgress('missing', { count: row.progress.missing })}
                    </span>
                  ) : null}
                  <span className="text-muted ml-auto tabular-nums">
                    {new Date(row.submissionDeadline).toLocaleDateString(locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {!isStaff && board.published.length > 0 ? (
        <Card>
          <CardTitle>{t('yourMarks')}</CardTitle>
          <ul className="mt-4 space-y-2 text-sm" data-testid="dashboard-marks">
            {board.published.map((row) => (
              <li key={row.assignmentId}>
                <Link href={`/classes/${row.classId}`} className="font-medium underline">
                  {row.caseTitle}
                </Link>
                <span className="text-muted ml-2">{row.className}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardTitle>{isStaff ? t('yourClasses') : t('enrolledOn')}</CardTitle>
        {board.classes.length === 0 ? (
          <p className="text-muted mt-3 text-sm">
            {isStaff ? t('noClassesStaff') : t('noClassesStudent')}
          </p>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2 text-sm">
            {board.classes.map((row) => (
              <li key={row.classId}>
                <Link
                  href={isStaff ? `/teaching/${row.classId}` : `/classes/${row.classId}`}
                  className="surface-card hover:border-brand-400 block rounded-lg px-3 py-2 transition-colors"
                >
                  <span className="font-medium">{row.className}</span>
                  <span className="text-muted ml-2 font-mono text-xs">{row.classCode}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

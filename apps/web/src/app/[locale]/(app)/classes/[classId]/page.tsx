import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  findMembership,
  getCase,
  getClassById,
  lateAtServerTime,
  listAssignmentsOfGroup,
  listClassesOfStudent,
  listGroups,
  listMembers,
  listSessions,
  listSubmissions,
} from '@casestudyhub/core';
import { DEFAULT_PRESENTATION_POLICY } from '@casestudyhub/shared';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { Alert } from '@/components/ui/form';
import { GroupPicker } from './group-picker';
import { GroupWorkspace } from './group-workspace';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ classId: string }>;
}): Promise<Metadata> {
  const { classId } = await params;
  const details = await getClassById(classId);
  return { title: details?.className ?? 'Class' };
}

export default async function StudentClassPage({
  params,
}: {
  params: Promise<{ locale: string; classId: string }>;
}) {
  const { locale, classId } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const t = await getTranslations('groups');
  const tClasses = await getTranslations('classes');
  const tWorkspace = await getTranslations('workspace');
  const tSession = await getTranslations('session');
  const tError = await getTranslations('errors');

  const details = await getClassById(classId);
  if (!details) notFound();

  // A student only sees a class they actually belong to.
  const enrollments = await listClassesOfStudent(user.uid);
  const enrolled = enrollments.some(
    (enrollment) => enrollment.classId === classId && enrollment.status === 'active',
  );
  if (!enrolled) {
    return <Alert tone="error">{tError('notInThisClass')}</Alert>;
  }

  const [groups, members, membership, sessions] = await Promise.all([
    listGroups(classId),
    listMembers(classId),
    findMembership(classId, user.uid),
    listSessions(classId),
  ]);

  // A session that has not started yet is not yet the class's business: the
  // slides and the question wall open when the group takes the floor.
  const openSessions = sessions.filter((session) => session.status !== 'scheduled');

  // A group's work area only exists once the group has a case to work on.
  const assignments = membership ? await listAssignmentsOfGroup(membership.groupId) : [];
  const assignment = assignments[0];
  const [submissions, caseStudy] = assignment
    ? await Promise.all([listSubmissions(assignment.id), getCase(assignment.caseStudyId)])
    : [[], null];

  // The server decides whether the window has closed, so every viewer of this
  // page sees the same answer whatever their device clock says.
  const overdue = assignment ? lateAtServerTime(assignment) : false;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{details.className}</h1>
        <p className="text-muted mt-2 font-mono text-sm">{details.classCode}</p>
      </div>

      {assignment ? (
        <Card>
          <CardTitle>{tWorkspace('title')}</CardTitle>
          <div className="mt-4">
            <GroupWorkspace
              assignment={assignment}
              deliverables={[...DEFAULT_PRESENTATION_POLICY.deliverables]}
              submissions={submissions}
              caseTitle={caseStudy?.title ?? assignment.caseStudyId}
              canSubmit={user.role === 'student'}
              overdue={overdue}
            />
          </div>
        </Card>
      ) : null}

      {openSessions.length > 0 ? (
        <Card>
          <CardTitle>{tSession('inClassTitle')}</CardTitle>
          <p className="text-muted mt-2 text-sm">{tSession('inClassHint')}</p>
          <ul className="mt-4 space-y-2">
            {openSessions.map((session) => {
              const group = groups.find((candidate) => candidate.id === session.groupId);
              return (
                <li key={session.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <Link
                    href={`/sessions/${session.id}`}
                    className="text-brand-600 dark:text-brand-300 font-medium underline"
                  >
                    {group?.groupName ?? session.groupId}
                  </Link>
                  <Badge tone={session.status === 'completed' ? 'neutral' : 'brand'}>
                    {tSession(`status.${session.status}`)}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardTitle>{t('title')}</CardTitle>
        <p className="text-muted mt-2 text-sm">{tClasses('groupsHint')}</p>
        <div className="mt-4">
          <GroupPicker classId={classId} groups={groups} members={members} ownUid={user.uid} />
        </div>
      </Card>
    </div>
  );
}

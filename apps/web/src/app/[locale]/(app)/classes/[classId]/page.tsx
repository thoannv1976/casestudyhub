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
  listSubmissions,
} from '@casestudyhub/core';
import { DEFAULT_PRESENTATION_POLICY } from '@casestudyhub/shared';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Card, CardTitle } from '@/components/ui/card';
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

  const [groups, members, membership] = await Promise.all([
    listGroups(classId),
    listMembers(classId),
    findMembership(classId, user.uid),
  ]);

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

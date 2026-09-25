import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  assertCanManageClass,
  getClassById,
  listAssignments,
  listCases,
  listClassLecturers,
  listGroups,
  listMembers,
  listRoster,
  listSessions,
  listClaims,
  listSubmissions,
  progressOfAssignments,
} from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { Alert } from '@/components/ui/form';
import { AssignmentManager } from './assignment-manager';
import { CaseSelectionBoard } from './case-selection-board';
import { GroupManager } from './group-manager';
import { RosterManager } from './roster-manager';
import { SessionBoard } from './session-board';
import { StaffManager } from './staff-manager';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; classId: string }>;
}): Promise<Metadata> {
  const { classId } = await params;
  const details = await getClassById(classId);
  return { title: details?.className ?? 'Class' };
}

export default async function ClassDetailPage({
  params,
}: {
  params: Promise<{ locale: string; classId: string }>;
}) {
  const { locale, classId } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const t = await getTranslations('roster');
  const tAssignments = await getTranslations('assignments');
  const tGroups = await getTranslations('groups');
  const tTeaching = await getTranslations('teaching');
  const tSession = await getTranslations('session');
  const tError = await getTranslations('errors');

  if (user.role !== 'lecturer' && user.role !== 'admin') {
    return <Alert tone="error">{tError('forbidden')}</Alert>;
  }

  const details = await getClassById(classId);
  if (!details) notFound();

  // A lecturer may only open their own class; an admin may open any.
  try {
    await assertCanManageClass(user, classId);
  } catch {
    return <Alert tone="error">{tError('notYourClass')}</Alert>;
  }

  const [roster, groups, members, assignments, cases, sessions] = await Promise.all([
    listRoster(classId),
    listGroups(classId),
    listMembers(classId),
    listAssignments(classId),
    listCases(),
    listSessions(classId),
  ]);

  const [lecturers, claims] = await Promise.all([listClassLecturers(classId), listClaims(classId)]);

  const submissionsByAssignment = Object.fromEntries(
    await Promise.all(
      assignments.map(
        async (assignment) => [assignment.id, await listSubmissions(assignment.id)] as const,
      ),
    ),
  );
  // Worked out on the server: it needs the policy each assignment froze, the
  // draft marks and the published grades, none of which the browser may read.
  const progressByAssignment = await progressOfAssignments(assignments);

  const joined = roster.filter((row) => row.studentUid && row.status === 'active').length;
  const expected = roster.filter((row) => row.status !== 'removed').length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{details.className}</h1>
          <p className="text-muted mt-2 font-mono text-sm">{details.classCode}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="brand">{t('joinedCount', { joined, expected })}</Badge>
          <Link
            href={`/teaching/${classId}/report`}
            className="text-brand-600 dark:text-brand-300 text-sm font-medium underline"
          >
            {tSession('classReport')}
          </Link>
        </div>
      </div>

      <Card>
        <CardTitle>{tTeaching('staffTitle')}</CardTitle>
        <p className="text-muted mt-2 text-sm">{tTeaching('staffHint')}</p>
        <div className="mt-4">
          <StaffManager classId={classId} lecturers={lecturers} />
        </div>
      </Card>

      <Card>
        <CardTitle>{tTeaching('joinMode')}</CardTitle>
        <p className="text-muted mt-2 text-sm">
          {details.joinMode === 'code'
            ? tTeaching('joinModeCode')
            : details.joinMode === 'approval'
              ? tTeaching('joinModeApproval')
              : tTeaching('joinModeClosed')}
        </p>
      </Card>

      <Card>
        <CardTitle>{t('title')}</CardTitle>
        <div className="mt-4">
          <RosterManager classId={classId} roster={roster} />
        </div>
      </Card>

      <Card>
        <CardTitle>{tGroups('title')}</CardTitle>
        <div className="mt-4">
          <GroupManager classId={classId} groups={groups} members={members} />
        </div>
      </Card>

      <Card>
        <CardTitle>{tSession('boardTitle')}</CardTitle>
        <p className="text-muted mt-2 text-sm">{tSession('boardHint')}</p>
        <div className="mt-4">
          <SessionBoard
            assignments={assignments}
            groups={groups}
            cases={cases}
            sessions={sessions}
            classId={classId}
            canGrade={user.role === 'lecturer' || user.role === 'admin'}
          />
        </div>
      </Card>

      <CaseSelectionBoard
        classId={classId}
        mode={details.caseSelection}
        deadline={details.caseSelectionDeadline ?? null}
        groupCount={groups.length}
        claims={claims.map((claim) => ({
          caseStudyId: claim.caseStudyId,
          caseTitle:
            cases.find((study) => study.id === claim.caseStudyId)?.title ?? claim.caseStudyId,
          caseCode: cases.find((study) => study.id === claim.caseStudyId)?.caseCode ?? '',
          groupName: groups.find((group) => group.id === claim.groupId)?.groupName ?? claim.groupId,
          claimedByName: claim.claimedByName,
          claimedAt: claim.claimedAt,
          scheduled: Boolean(claim.assignmentId),
        }))}
      />

      <Card>
        <CardTitle>{tAssignments('title')}</CardTitle>
        <div className="mt-4">
          <AssignmentManager
            classId={classId}
            groups={groups}
            cases={cases}
            assignments={assignments}
            submissionsByAssignment={submissionsByAssignment}
            progressByAssignment={progressByAssignment}
          />
        </div>
      </Card>
    </div>
  );
}

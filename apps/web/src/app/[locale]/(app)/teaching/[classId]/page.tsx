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
  currentVersions,
  listSubmissions,
  getClassProject,
  getLecturerAssessment,
  findSessionForAssignment,
  listProjectVolunteers,
  projectDeliverables,
  projectTarget,
  progressOfAssignments,
  isLtiEnabled,
  ltiLinksOfClass,
  caseSetOfClass,
  listCourses,
  listClassesOfLecturer,
  listAllClasses,
} from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { Alert } from '@/components/ui/form';
import { AssignmentManager } from './assignment-manager';
import { ProjectManager, type ProjectRow } from './project-manager';
import { CaseSelectionBoard } from './case-selection-board';
import { CaseSetManager } from './case-set-manager';
import { GroupManager } from './group-manager';
import { RosterManager } from './roster-manager';
import { SessionBoard } from './session-board';
import { StaffManager } from './staff-manager';
import { MoodlePanel } from './moodle-panel';

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
  const tProject = await getTranslations('project');
  const tOverview = await getTranslations('overview');

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

  // The class's own cases from the shared library, and the classes it could
  // copy a set from: the lecturer's own, or every class for an admin.
  const [caseSet, courses, teachable] = await Promise.all([
    caseSetOfClass(classId),
    listCourses(),
    user.role === 'admin' ? listAllClasses() : listClassesOfLecturer(user.uid),
  ]);
  const tCaseSelection = await getTranslations('caseSelection');

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

  // The class group project: one deadline for everybody, and what each group
  // has handed in against it. Read per group because the submissions are
  // stored per group, exactly as they are for a case study.
  const project = await getClassProject(classId);
  const projectItems = project ? await projectDeliverables(project) : [];
  const volunteers = project ? await listProjectVolunteers(classId) : [];
  const projectRows: ProjectRow[] = project
    ? await Promise.all(
        groups.map(async (group) => {
          const target = await projectTarget(classId, group.id);
          const [current, assessment, session] = target
            ? await Promise.all([
                listSubmissions(target.id).then(currentVersions),
                getLecturerAssessment(target.id),
                findSessionForAssignment(target.id),
              ])
            : [[], null, null];
          return {
            groupId: group.id,
            groupName: group.groupName,
            marked: assessment !== null,
            slot: volunteers.find((row) => row.groupId === group.id)?.slot ?? null,
            sessionId: session?.id ?? null,
            targetId: target?.id ?? '',
            handedIn: Object.fromEntries(
              current.map((submission) => [
                submission.deliverableId,
                {
                  fileName: submission.fileName,
                  isLate: submission.isLate,
                  versionNumber: submission.versionNumber,
                },
              ]),
            ),
          };
        }),
      )
    : [];

  // Only when the class is reachable from Moodle: a panel about a connection
  // that does not exist would only raise questions.
  const moodle = isLtiEnabled() ? await ltiLinksOfClass(classId) : null;
  const tLti = await getTranslations('lti');

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
            href={`/teaching/${classId}/overview`}
            className="text-brand-600 dark:text-brand-300 text-sm font-medium underline"
          >
            {tOverview('title')}
          </Link>
          <Link
            href={`/teaching/${classId}/report`}
            className="text-brand-600 dark:text-brand-300 text-sm font-medium underline"
          >
            {tSession('classReport')}
          </Link>
          <Link
            href={`/teaching/${classId}/questions`}
            className="text-brand-600 dark:text-brand-300 text-sm font-medium underline"
          >
            {tCaseSelection('qaLink')}
          </Link>
          <Link
            href={`/teaching/${classId}/participation`}
            className="text-brand-600 dark:text-brand-300 text-sm font-medium underline"
          >
            {tCaseSelection('participationLink')}
          </Link>
        </div>
      </div>

      {moodle && moodle.courses.length > 0 ? (
        <Card>
          <CardTitle>{tLti('panelTitle')}</CardTitle>
          <div className="mt-4">
            <MoodlePanel
              classId={classId}
              courses={moodle.courses}
              activities={moodle.activities}
            />
          </div>
        </Card>
      ) : null}

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
          <GroupManager classId={classId} groups={groups} members={members} roster={roster} />
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

      <Card>
        <CardTitle>{tCaseSelection('setTitle')}</CardTitle>
        <p className="text-muted mt-2 text-sm">{tCaseSelection('setBody')}</p>
        <div className="mt-4">
          <CaseSetManager
            classId={classId}
            courseId={details.courseId}
            cases={cases.map((study) => ({
              id: study.id,
              caseCode: study.caseCode,
              title: study.title,
              company: study.company,
              courseId: study.courseId,
              status: study.status,
            }))}
            courses={courses.map((course) => ({ id: course.id, name: course.name }))}
            explicit={caseSet.explicit}
            caseIds={caseSet.caseIds}
            groupsPerCase={caseSet.groupsPerCase}
            claimedCaseIds={caseSet.claimedCaseIds}
            otherClasses={teachable
              .filter((row) => row.id !== classId)
              .map((row) => ({ id: row.id, label: `${row.classCode} · ${row.className}` }))}
          />
        </div>
      </Card>

      <CaseSelectionBoard
        classId={classId}
        mode={details.caseSelection}
        deadline={details.caseSelectionDeadline ?? null}
        groupCount={groups.length}
        claims={claims.map((claim) => ({
          id: claim.id,
          groupId: claim.groupId,
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
        <CardTitle>{tProject('title')}</CardTitle>
        <p className="text-muted mt-2 text-sm">{tProject('lecturerHint')}</p>
        <div className="mt-4">
          <ProjectManager
            classId={classId}
            deadline={project?.deadline ?? null}
            deliverables={projectItems}
            rows={projectRows}
            slots={project?.presentationSlots ?? 0}
            volunteerCount={volunteers.length}
          />
        </div>
      </Card>

      <Card>
        <CardTitle>{tAssignments('title')}</CardTitle>
        <div className="mt-4">
          <AssignmentManager
            classId={classId}
            groups={groups}
            cases={cases}
            classCaseIds={caseSet.caseIds}
            assignments={assignments}
            submissionsByAssignment={submissionsByAssignment}
            progressByAssignment={progressByAssignment}
          />
        </div>
      </Card>
    </div>
  );
}

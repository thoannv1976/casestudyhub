import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  choosableCases,
  findMembership,
  getCase,
  getPolicy,
  getClassById,
  lateAtServerTime,
  listAssignmentsOfGroup,
  listClassesOfStudent,
  listGroups,
  listMembers,
  listPublishedGradesOfStudent,
  listSessions,
  listSubmissions,
  policyOfAssignment,
  projectTarget,
} from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { CasePicker } from './case-picker';
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
  const tGrading = await getTranslations('grading');
  const tProject = await getTranslations('project');
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

  // The picker only appears in a class whose lecturer opened self-selection,
  // and it is built from the same reads the rest of the page already made.
  const picker = details.caseSelection === 'groups_choose' ? await choosableCases(classId) : null;
  const groupNameOf = (groupId: string) =>
    groups.find((group) => group.id === groupId)?.groupName ?? groupId;
  const ownGroupHasCase = Boolean(
    picker?.cases.some((row) => row.claim && row.claim.groupId === membership?.groupId),
  );

  /**
   * A group's work area, one per case it has been given.
   *
   * Every case, not the first one: a group can be set more than one in a term,
   * and showing a single card left the other one with no way to hand anything
   * in at all.
   */
  const assignments = membership ? await listAssignmentsOfGroup(membership.groupId) : [];
  const published = await listPublishedGradesOfStudent(user.uid);

  const cards = await Promise.all(
    assignments.map(async (assignment) => {
      const [submissions, caseStudy, policy] = await Promise.all([
        listSubmissions(assignment.id),
        getCase(assignment.caseStudyId),
        // The version this assignment froze, so two cases set under two
        // frameworks each ask for what they actually asked for.
        policyOfAssignment(assignment),
      ]);
      return {
        assignment,
        submissions,
        caseStudy,
        policy,
        // The server decides whether the window has closed, so every viewer
        // sees the same answer whatever their device clock says.
        overdue: lateAtServerTime(assignment),
        // A mark exists for a student only once the lecturer published it; a
        // draft is the lecturer's working note, not a result.
        grade: published.find((row) => row.assignmentId === assignment.id) ?? null,
      };
    }),
  );

  // The class group project is separate work from any case study: every group
  // hands the same one in, in the final week. It appears as soon as the
  // lecturer has set a deadline, whether or not the group has a case yet.
  const project = membership ? await projectTarget(classId, membership.groupId) : null;
  const projectSubmissions = project ? await listSubmissions(project.id) : [];
  const projectOverdue = project ? lateAtServerTime(project) : false;

  // Two different frameworks can be in play for one mark, and conflating them
  // would be a quiet lie: the deliverables a group still owes come from the
  // version their assignment froze, while the weighting behind a published
  // mark is whatever that mark was computed under.
  const marks = await Promise.all(
    cards
      .filter((card) => card.grade !== null)
      .map(async (card) => ({
        assignmentId: card.assignment.id,
        title: card.caseStudy?.title ?? card.assignment.caseStudyId,
        grade: card.grade,
        policy: await getPolicy(card.grade!.policyId, card.grade!.policyVersion),
      })),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{details.className}</h1>
        <p className="text-muted mt-2 font-mono text-sm">{details.classCode}</p>
      </div>

      {picker ? (
        <CasePicker
          classId={classId}
          deadline={details.caseSelectionDeadline ?? null}
          ownGroupHasCase={ownGroupHasCase}
          // Whether the window is open was decided by the server, with the
          // server's clock: the deadline is the same for everybody in the class.
          canChoose={Boolean(membership?.groupId) && picker.open && user.role === 'student'}
          cases={picker.cases.map((row) => ({
            study: {
              id: row.study.id,
              caseCode: row.study.caseCode,
              title: row.study.title,
              company: row.study.company,
            },
            takenByGroupName: row.claim ? groupNameOf(row.claim.groupId) : null,
            takenByOwnGroup: row.claim?.groupId === membership?.groupId,
          }))}
        />
      ) : null}

      {cards.map((card) => (
        <Card key={card.assignment.id}>
          <CardTitle>{tWorkspace('title')}</CardTitle>
          <div className="mt-4">
            <GroupWorkspace
              targetId={card.assignment.id}
              deliverables={[...card.policy.deliverables]}
              submissions={card.submissions}
              subjectLabel={tWorkspace('case')}
              subject={card.caseStudy?.title ?? card.assignment.caseStudyId}
              presentationDate={card.assignment.presentationDate}
              submissionDeadline={card.assignment.submissionDeadline}
              canSubmit={user.role === 'student'}
              overdue={card.overdue}
            />
          </div>
        </Card>
      ))}

      {project ? (
        <Card>
          <CardTitle>{tProject('title')}</CardTitle>
          <p className="text-muted mt-2 text-sm">{tProject('studentHint')}</p>
          <div className="mt-4">
            <GroupWorkspace
              targetId={project.id}
              deliverables={project.deliverables}
              submissions={projectSubmissions}
              subjectLabel={tProject('subjectLabel')}
              subject={tProject('subject')}
              submissionDeadline={project.submissionDeadline}
              canSubmit={user.role === 'student'}
              overdue={projectOverdue}
            />
          </div>
        </Card>
      ) : null}

      {marks.map((mark) => (
        <Card key={mark.assignmentId}>
          <CardTitle>{tGrading('yourMark')}</CardTitle>
          <p className="text-muted mt-1 text-sm">{mark.title}</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums">{mark.grade?.finalScore}</p>
          <p className="text-muted mt-2 text-sm">
            {tGrading('yourMarkBreakdown', {
              group: mark.grade?.groupScore ?? 0,
              individual: mark.grade?.individualScore ?? 0,
              team: Math.round(mark.policy.grading.teamWeight * 100),
              solo: Math.round(mark.policy.grading.individualWeight * 100),
            })}
          </p>
          <p className="text-muted mt-1 text-xs">
            {tGrading('policyVersion', { version: mark.grade?.policyVersion ?? '' })}
          </p>
        </Card>
      ))}

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

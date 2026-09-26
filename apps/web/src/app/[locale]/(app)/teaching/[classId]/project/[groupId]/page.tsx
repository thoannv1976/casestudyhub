import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  assertCanManageClass,
  getClassProject,
  getLecturerAssessment,
  getPolicy,
  groupSubmittedLate,
  listGroups,
  listMembers,
  listSubmissions,
  projectTarget,
} from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { GradeForm } from '../../grade/[assignmentId]/grade-form';
import { HandedIn } from '../../handed-in';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Marking the group project' };

/**
 * Marking the class group project.
 *
 * Its own screen rather than a branch of the case study one: there is no room,
 * no clock and no question wall behind this mark. What there is instead is
 * what the group handed in - a deck, a report and a video - and two pieces of
 * work that earn points outside the rubric.
 *
 * The marking itself runs through exactly the same pipeline as a case study:
 * one draft, one preview, one transaction that publishes for the whole group
 * or for nobody.
 */
export default async function ProjectGradePage({
  params,
}: {
  params: Promise<{ locale: string; classId: string; groupId: string }>;
}) {
  const { locale, classId, groupId } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const t = await getTranslations('grading');
  const tProject = await getTranslations('project');
  const tError = await getTranslations('errors');

  if (user.role !== 'lecturer' && user.role !== 'admin') {
    return <Alert tone="error">{tError('forbidden')}</Alert>;
  }

  try {
    await assertCanManageClass(user, classId);
  } catch {
    return <Alert tone="error">{tError('notYourClass')}</Alert>;
  }

  const project = await getClassProject(classId);
  if (!project) notFound();

  const target = await projectTarget(classId, groupId);
  if (!target) notFound();

  // The version the project froze, so a framework published since cannot
  // change what this group is marked against.
  const policy = await getPolicy(project.policyId, project.policyVersion);

  const [groups, members, assessment, isLate, submissions] = await Promise.all([
    listGroups(classId),
    listMembers(classId),
    getLecturerAssessment(target.id),
    groupSubmittedLate(target.id),
    listSubmissions(target.id),
  ]);

  const group = groups.find((candidate) => candidate.id === groupId);
  if (!group || group.classId !== classId) notFound();

  const team = members.filter((member) => member.groupId === groupId);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{tProject('grade')}</h1>
          <p className="text-muted mt-2 text-sm">
            {group.groupName} · {tProject('subject')}
          </p>
        </div>
        <Badge tone={assessment?.status === 'published' ? 'brand' : 'neutral'}>
          {t(`status.${assessment?.status ?? 'unmarked'}`)}
        </Badge>
      </div>

      <Card>
        <CardTitle>{tProject('title')}</CardTitle>
        <p className="text-muted mt-2 text-sm">{tProject('grade')}</p>
        <p className="mt-4 text-sm">
          {isLate
            ? t('evidenceLate', { points: policy.grading.lateSubmissionPenaltyPoints })
            : t('evidenceOnTime')}
        </p>
        <div className="mt-4">
          <HandedIn deliverables={target.deliverables} submissions={submissions} />
        </div>
      </Card>

      <Card>
        <CardTitle>{t('markTitle')}</CardTitle>
        <p className="text-muted mt-2 text-sm">{t('projectSubtitle')}</p>
        <div className="mt-4">
          <GradeForm
            assignmentId={target.id}
            members={team.map((member) => ({
              studentUid: member.studentUid,
              studentId: member.studentId,
              fullName: member.fullName,
              roleIds: member.roleIds,
            }))}
            assessment={assessment}
            policy={policy}
            rubric={policy.projectRubric}
            bonus={policy.projectBonus}
            isLate={isLate}
            // Drafting and publishing a mark are the lecturer's alone; an
            // admin supporting the class may look but not judge.
            canPublish={user.role === 'lecturer'}
          />
        </div>
      </Card>
    </div>
  );
}

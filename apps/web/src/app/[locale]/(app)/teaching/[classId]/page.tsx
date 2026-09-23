import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  assertCanManageClass,
  getClassById,
  listGroups,
  listMembers,
  listRoster,
} from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { GroupManager } from './group-manager';
import { RosterManager } from './roster-manager';

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
  const tGroups = await getTranslations('groups');
  const tTeaching = await getTranslations('teaching');
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

  const [roster, groups, members] = await Promise.all([
    listRoster(classId),
    listGroups(classId),
    listMembers(classId),
  ]);
  const joined = roster.filter((row) => row.studentUid && row.status === 'active').length;
  const expected = roster.filter((row) => row.status !== 'removed').length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{details.className}</h1>
          <p className="text-muted mt-2 font-mono text-sm">{details.classCode}</p>
        </div>
        <Badge tone="brand">{t('joinedCount', { joined, expected })}</Badge>
      </div>

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
    </div>
  );
}

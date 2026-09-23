import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getClassById, listClassesOfStudent, listGroups, listMembers } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { Card, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/form';
import { GroupPicker } from './group-picker';

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

  const [groups, members] = await Promise.all([listGroups(classId), listMembers(classId)]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{details.className}</h1>
        <p className="text-muted mt-2 font-mono text-sm">{details.classCode}</p>
      </div>

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

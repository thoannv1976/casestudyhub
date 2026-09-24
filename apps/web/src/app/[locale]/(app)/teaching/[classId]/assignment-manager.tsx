'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Assignment, CaseStudy, Group, Submission } from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button, Field, Input, Select } from '@/components/ui/form';

/**
 * Setting a case for a group, and the progress table of SRS 4.2: who has
 * handed in what, and which of it arrived late.
 */
export function AssignmentManager({
  classId,
  groups,
  cases,
  assignments,
  submissionsByAssignment,
}: {
  classId: string;
  groups: Group[];
  cases: CaseStudy[];
  assignments: Assignment[];
  submissionsByAssignment: Record<string, Submission[]>;
}) {
  const t = useTranslations('assignments');
  const tError = useTranslations();
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const published = cases.filter((study) => study.status === 'published');

  async function assign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setErrorKey(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/classes/${classId}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: String(form.get('groupId') ?? ''),
          caseStudyId: String(form.get('caseStudyId') ?? ''),
          presentationDate: new Date(String(form.get('presentationDate') ?? '')).toISOString(),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setErrorKey(payload?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      setNotice(t('assigned'));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const nameOfGroup = (groupId: string) =>
    groups.find((group) => group.id === groupId)?.groupName ?? groupId;
  const nameOfCase = (caseId: string) =>
    cases.find((study) => study.id === caseId)?.title ?? caseId;

  return (
    <div className="space-y-6">
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {groups.length === 0 || published.length === 0 ? (
        <Alert tone="error">{t('needsGroupsAndCase')}</Alert>
      ) : (
        <form onSubmit={assign} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('group')} htmlFor="assignGroupId">
              <Select id="assignGroupId" name="groupId" required>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.groupName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('case')} htmlFor="caseStudyId">
              <Select id="caseStudyId" name="caseStudyId" required>
                {published.map((study) => (
                  <option key={study.id} value={study.id}>
                    {study.caseCode} — {study.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('presentationDate')}
              htmlFor="presentationDate"
              hint={t('deadlineDerived')}
            >
              <Input id="presentationDate" name="presentationDate" type="datetime-local" required />
            </Field>
          </div>
          <Button type="submit" disabled={busy}>
            {t('assign')}
          </Button>
        </form>
      )}

      {assignments.length === 0 ? (
        <p className="text-muted text-sm">{t('none')}</p>
      ) : (
        <div className="surface-card overflow-x-auto rounded-xl">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('group')}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('case')}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('deadline')}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('handedIn')}
                </th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((assignment) => {
                const submissions = submissionsByAssignment[assignment.id] ?? [];
                const current = new Map<string, Submission>();
                for (const submission of submissions) {
                  const held = current.get(submission.deliverableId);
                  if (!held || submission.versionNumber > held.versionNumber) {
                    current.set(submission.deliverableId, submission);
                  }
                }
                const latest = [...current.values()];
                const late = latest.filter((submission) => submission.isLate).length;

                return (
                  <tr key={assignment.id} className="border-b border-[var(--border-subtle)]">
                    <td className="px-4 py-3">{nameOfGroup(assignment.groupId)}</td>
                    <td className="px-4 py-3">{nameOfCase(assignment.caseStudyId)}</td>
                    <td className="px-4 py-3">
                      {new Date(assignment.submissionDeadline).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      {latest.length === 0 ? (
                        <span className="text-muted">{t('nothingYet')}</span>
                      ) : (
                        <span>
                          {t('itemCount', { count: latest.length })}
                          {late > 0 ? (
                            <span className="ml-2 text-red-600 dark:text-red-400">
                              {t('lateCount', { count: late })}
                            </span>
                          ) : null}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

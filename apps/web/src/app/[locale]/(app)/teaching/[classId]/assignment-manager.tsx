'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  PROGRESS_FILTERS,
  matchesFilter,
  type Assignment,
  type AssignmentProgress,
  type CaseStudy,
  type Group,
  type ProgressFilter,
  type Submission,
} from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button, Field, Input, Select } from '@/components/ui/form';

/**
 * Setting a case for a group, and the progress table of SRS 4.2: who has
 * handed in what, and which of it arrived late.
 */
/** An assignment the server could not classify is shown, never hidden. */
const EMPTY_PROGRESS: AssignmentProgress = {
  state: 'awaiting',
  missing: 0,
  lateItems: 0,
  needsLecturer: false,
};

export function AssignmentManager({
  classId,
  groups,
  cases,
  assignments,
  submissionsByAssignment,
  progressByAssignment,
}: {
  classId: string;
  groups: Group[];
  cases: CaseStudy[];
  assignments: Assignment[];
  submissionsByAssignment: Record<string, Submission[]>;
  /** Worked out on the server, where the frozen policy and the marks live. */
  progressByAssignment: Record<string, AssignmentProgress>;
}) {
  const t = useTranslations('assignments');
  const tProgress = useTranslations('progress');
  const tError = useTranslations();

  /**
   * Six groups is a list; thirty is a wall. The lecturer's real question is
   * "which ones are behind", so the filter answers that first and everything
   * else is a way back to the whole list.
   */
  const [filter, setFilter] = useState<ProgressFilter>('all');

  const visible = assignments.filter((assignment) =>
    matchesFilter(progressByAssignment[assignment.id] ?? EMPTY_PROGRESS, filter),
  );
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
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted text-sm">{tProgress('filterLabel')}</span>
            {PROGRESS_FILTERS.map((option) => {
              const count = assignments.filter((assignment) =>
                matchesFilter(progressByAssignment[assignment.id] ?? EMPTY_PROGRESS, option),
              ).length;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={filter === option}
                  onClick={() => setFilter(option)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    filter === option
                      ? 'bg-brand-600 text-white'
                      : 'surface-card text-muted hover:border-brand-400'
                  }`}
                >
                  {tProgress(option)} ({count})
                </button>
              );
            })}
          </div>

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
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {tProgress('columnLabel')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((assignment) => {
                  const progress = progressByAssignment[assignment.id] ?? EMPTY_PROGRESS;
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
                      <td className="px-4 py-3">
                        <span
                          className={
                            progress.state === 'overdue'
                              ? 'font-medium text-red-600 dark:text-red-400'
                              : ''
                          }
                        >
                          {tProgress(progress.state)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visible.length === 0 ? (
              <p className="text-muted px-4 py-3 text-sm">{tProgress('noneMatch')}</p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

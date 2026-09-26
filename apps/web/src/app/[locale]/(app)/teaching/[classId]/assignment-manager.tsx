'use client';

import { Fragment, useState } from 'react';
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
/**
 * `datetime-local` wants a local wall-clock string, not an ISO instant. Slicing
 * the ISO string would show the lecturer UTC and silently move every date by
 * seven hours.
 */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

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
  /** Which row has its date open for editing, if any. */
  const [editing, setEditing] = useState<string | null>(null);

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

  /**
   * Moves a presentation that has already been set. The submission deadline
   * moves with it, worked out on the server from the framework version this
   * assignment froze - which is why nothing here tries to compute one.
   */
  async function reschedule(assignmentId: string, event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setErrorKey(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/classes/${classId}/assignments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentId,
          presentationDate: new Date(String(form.get('newPresentationDate') ?? '')).toISOString(),
          reason: String(form.get('reason') ?? ''),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setErrorKey(payload?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      setEditing(null);
      setNotice(t('rescheduled'));
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
    <div className="space-y-6" data-testid="assignment-manager">
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
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)]">
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {t('group')}
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {t('case')}
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {t('presentationDate')}
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
                  <th scope="col" className="px-4 py-3 font-semibold">
                    <span className="sr-only">{t('changeDate')}</span>
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

                  const isEditing = editing === assignment.id;
                  const row = (
                    <tr key={assignment.id} className="border-b border-[var(--border-subtle)]">
                      <td className="px-4 py-3">{nameOfGroup(assignment.groupId)}</td>
                      <td className="px-4 py-3">{nameOfCase(assignment.caseStudyId)}</td>
                      <td className="px-4 py-3">
                        {new Date(assignment.presentationDate).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        {new Date(assignment.submissionDeadline).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        {latest.length === 0 ? (
                          <span className="text-muted">{t('nothingYet')}</span>
                        ) : (
                          // Named and openable, not counted. A lecturer asking
                          // what a group handed in should not have to open
                          // another screen to find out.
                          <ul className="space-y-1">
                            {latest.map((submission) => (
                              <li key={submission.id}>
                                <a
                                  href={
                                    submission.externalUrl ??
                                    `/api/submissions/${submission.id}/file`
                                  }
                                  target={submission.externalUrl ? '_blank' : undefined}
                                  rel={submission.externalUrl ? 'noreferrer' : undefined}
                                  className="text-brand-600 dark:text-brand-300 underline"
                                >
                                  {submission.fileName}
                                </a>
                                {submission.isLate ? (
                                  <span className="ml-2 text-xs text-red-600 dark:text-red-400">
                                    {t('lateOne')}
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
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
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setEditing(isEditing ? null : assignment.id)}
                        >
                          {isEditing ? t('cancel') : t('changeDate')}
                        </Button>
                      </td>
                    </tr>
                  );

                  const editor = isEditing ? (
                    <tr
                      key={`${assignment.id}__edit`}
                      className="border-b border-[var(--border-subtle)]"
                    >
                      <td colSpan={7} className="px-4 py-4">
                        <form
                          onSubmit={(event) => void reschedule(assignment.id, event)}
                          className="space-y-3"
                        >
                          <div className="grid gap-4 sm:grid-cols-2">
                            <Field
                              label={t('newPresentationDate')}
                              htmlFor={`newPresentationDate__${assignment.id}`}
                              hint={t('deadlineFollows')}
                            >
                              <Input
                                id={`newPresentationDate__${assignment.id}`}
                                name="newPresentationDate"
                                type="datetime-local"
                                defaultValue={toLocalInput(assignment.presentationDate)}
                                required
                              />
                            </Field>
                            <Field
                              label={t('reason')}
                              htmlFor={`reason__${assignment.id}`}
                              hint={t('reasonHint')}
                            >
                              <Input
                                id={`reason__${assignment.id}`}
                                name="reason"
                                minLength={10}
                                required
                              />
                            </Field>
                          </div>
                          <Button type="submit" disabled={busy}>
                            {t('saveDate')}
                          </Button>
                        </form>
                      </td>
                    </tr>
                  ) : null;

                  return editor ? (
                    <Fragment key={assignment.id}>
                      {row}
                      {editor}
                    </Fragment>
                  ) : (
                    row
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

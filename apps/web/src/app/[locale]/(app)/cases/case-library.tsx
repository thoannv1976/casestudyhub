'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  CASE_FILE_KINDS,
  LOCALES,
  currentAttachments,
  type CaseFileKind,
  type CaseStudy,
} from '@casestudyhub/shared';
import { Link, useRouter } from '@/i18n/navigation';
import { Badge } from '@/components/ui/card';
import { Alert, Button, Field, Input, Select } from '@/components/ui/form';
import { BulkCreate } from './bulk-create';

export interface CaseUsageView {
  classes: number;
  assignments: number;
}

type StatusFilter = 'active' | 'published' | 'draft' | 'archived' | 'all';

/**
 * The shared case library.
 *
 * A case is uploaded once and serves every class after it, so the library
 * grows term by term; finding, filing and retiring cases is most of what a
 * lecturer does here. Students see the cases they may read and nothing else.
 */
export function CaseLibrary({
  cases,
  courses,
  canEdit,
  usage = {},
}: {
  cases: CaseStudy[];
  courses: { id: string; name: string }[];
  canEdit: boolean;
  /** Staff only: which classes and assignments use each case. */
  usage?: Record<string, CaseUsageView>;
}) {
  const t = useTranslations('cases');
  const tError = useTranslations();
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [courseFilter, setCourseFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [kinds, setKinds] = useState<Record<string, CaseFileKind>>({});
  const uploadInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const courseName = (id: string) => courses.find((course) => course.id === id)?.name ?? '';

  function reportError(payload: unknown) {
    const error = (
      payload as { error?: { messageKey?: string; details?: Record<string, unknown> } }
    )?.error;
    setErrorKey(error?.messageKey ?? 'errors.unexpected');
    setErrorDetail(
      error?.details ? Object.values(error.details).filter(Boolean).join(' · ') : null,
    );
  }

  function clearMessages() {
    setErrorKey(null);
    setErrorDetail(null);
    setNotice(null);
  }

  async function createCase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    clearMessages();
    try {
      const response = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseCode: String(form.get('caseCode') ?? ''),
          title: String(form.get('title') ?? ''),
          company: String(form.get('company') ?? '') || undefined,
          courseId: String(form.get('courseId') ?? ''),
          language: String(form.get('language') ?? 'en'),
          cloIds: String(form.get('cloIds') ?? '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        }),
      });
      if (!response.ok) {
        reportError(await response.json().catch(() => null));
        return;
      }
      setNotice(t('created'));
      (event.target as HTMLFormElement).reset();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  /** One file after another, so a refusal names the file it was about. */
  async function upload(caseId: string, files: File[]) {
    setBusy(true);
    clearMessages();
    const done: string[] = [];
    try {
      for (const file of files) {
        const body = new FormData();
        body.set('file', file);
        body.set('kind', kinds[caseId] ?? 'case');

        const response = await fetch(`/api/cases/${caseId}/attachments`, { method: 'POST', body });
        if (!response.ok) {
          reportError(await response.json().catch(() => null));
          setErrorDetail((current) => [file.name, current].filter(Boolean).join(' · '));
          break;
        }
        done.push(file.name);
      }
      if (done.length > 0) setNotice(t('uploaded', { fileName: done.join(', ') }));
      const input = uploadInputs.current[caseId];
      if (input) input.value = '';
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removeFile(caseId: string, attachmentId: string, fileName: string) {
    if (!window.confirm(t('removeConfirm', { fileName }))) return;
    setBusy(true);
    clearMessages();
    try {
      const response = await fetch(`/api/cases/${caseId}/attachments/${attachmentId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        reportError(await response.json().catch(() => null));
        return;
      }
      setNotice(t('removed', { fileName }));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(caseId: string, status: CaseStudy['status']) {
    setBusy(true);
    clearMessages();
    try {
      const response = await fetch(`/api/cases/${caseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        reportError(await response.json().catch(() => null));
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function archive(study: CaseStudy) {
    if (!window.confirm(t('archiveConfirm', { code: study.caseCode }))) return;
    void setStatus(study.id, 'archived');
  }

  function restore(study: CaseStudy) {
    // Back to students only if there is still something for them to read.
    const hasMaterial = currentAttachments(study.attachments).length > 0;
    void setStatus(study.id, hasMaterial ? 'published' : 'draft');
  }

  const needle = query.trim().toLowerCase();
  const shown = cases.filter((study) => {
    if (canEdit) {
      if (courseFilter !== 'all' && study.courseId !== courseFilter) return false;
      if (statusFilter === 'active' && study.status === 'archived') return false;
      if (statusFilter !== 'active' && statusFilter !== 'all' && study.status !== statusFilter) {
        return false;
      }
    }
    if (!needle) return true;
    return [study.caseCode, study.title, study.company ?? '', study.industry ?? '']
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });

  const statusLabel = (status: CaseStudy['status']) =>
    status === 'published' ? t('published') : status === 'archived' ? t('archived') : t('draft');

  return (
    <div className="space-y-8">
      {errorKey ? (
        <Alert tone="error">
          {tError(errorKey)}
          {errorDetail ? ` (${errorDetail})` : ''}
        </Alert>
      ) : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      {canEdit ? (
        <form onSubmit={createCase} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('caseCode')} htmlFor="caseCode">
              <Input id="caseCode" name="caseCode" placeholder="CASE01" required />
            </Field>
            <Field label={t('caseTitle')} htmlFor="title">
              <Input id="title" name="title" placeholder="Amazon" required />
            </Field>
            <Field label={t('company')} htmlFor="company">
              <Input id="company" name="company" placeholder="Amazon.com, Inc." />
            </Field>
            <Field label={t('course')} htmlFor="courseId">
              <Select id="courseId" name="courseId" required>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('clos')} htmlFor="cloIds" hint={t('closHint')}>
              <Input id="cloIds" name="cloIds" placeholder="CLO1, CLO2, CLO4, CLO6" />
            </Field>
            <Field label={t('language')} htmlFor="language">
              <Select id="language" name="language" defaultValue="en">
                {LOCALES.map((value) => (
                  <option key={value} value={value}>
                    {value === 'vi' ? 'Tiếng Việt' : 'English'}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Button type="submit" disabled={busy || courses.length === 0}>
            {t('createCase')}
          </Button>
          {courses.length === 0 ? <Alert tone="error">{t('needsCourse')}</Alert> : null}
        </form>
      ) : null}

      {canEdit && courses.length > 0 ? (
        <BulkCreate
          courses={courses}
          existingCodes={cases.map((study) => study.caseCode)}
          busy={busy}
          onBusy={setBusy}
        />
      ) : null}

      <div className="flex flex-wrap items-end gap-3" data-testid="case-filters">
        <div className="min-w-[14rem] flex-1">
          <Field label={t('search')} htmlFor="caseSearch">
            <Input
              id="caseSearch"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </Field>
        </div>
        {canEdit ? (
          <>
            <Field label={t('course')} htmlFor="caseCourseFilter">
              <Select
                id="caseCourseFilter"
                value={courseFilter}
                onChange={(event) => setCourseFilter(event.target.value)}
              >
                <option value="all">{t('allCourses')}</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('statusFilter')} htmlFor="caseStatusFilter">
              <Select
                id="caseStatusFilter"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              >
                <option value="active">{t('statusActive')}</option>
                <option value="published">{t('published')}</option>
                <option value="draft">{t('draft')}</option>
                <option value="archived">{t('archived')}</option>
                <option value="all">{t('statusAll')}</option>
              </Select>
            </Field>
          </>
        ) : null}
        <span className="text-muted pb-2 text-sm">
          {t('countShown', { shown: shown.length, total: cases.length })}
        </span>
      </div>

      {cases.length === 0 ? (
        <p className="text-muted text-sm">{t('empty')}</p>
      ) : (
        <ul className="space-y-4">
          {shown.map((study) => {
            const files = currentAttachments(study.attachments);
            const used = usage[study.id];
            return (
              <li key={study.id} className="surface-card rounded-xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">
                      <span className="font-mono text-sm">{study.caseCode}</span> — {study.title}
                    </h3>
                    {study.company ? <p className="text-muted text-sm">{study.company}</p> : null}
                    {canEdit ? (
                      <p className="text-muted mt-1 text-xs">
                        {courseName(study.courseId)}
                        {study.cloIds.length > 0 ? ` · ${study.cloIds.join(' · ')}` : ''}
                      </p>
                    ) : study.cloIds.length > 0 ? (
                      <p className="text-muted mt-1 text-xs">{study.cloIds.join(' · ')}</p>
                    ) : null}
                    {canEdit ? (
                      <p className="text-muted mt-1 text-xs" data-testid="case-usage">
                        {used && (used.classes > 0 || used.assignments > 0)
                          ? t('usage', { classes: used.classes, assignments: used.assignments })
                          : t('usageNone')}
                      </p>
                    ) : null}
                    <p className="mt-2 text-sm">
                      <Link
                        href={`/cases/${study.id}`}
                        className="text-brand-600 dark:text-brand-300 font-medium underline"
                      >
                        {t('openBank')}
                      </Link>
                    </p>
                  </div>
                  {study.status === 'archived' ? (
                    <Badge tone="neutral">{statusLabel(study.status)}</Badge>
                  ) : (
                    <span
                      className={
                        study.status === 'published'
                          ? 'text-brand-600 dark:text-brand-300 text-sm font-medium'
                          : 'text-muted text-sm'
                      }
                    >
                      {statusLabel(study.status)}
                    </span>
                  )}
                </div>

                <ul className="mt-3 space-y-1 text-sm">
                  {files.length === 0 ? (
                    <li className="text-muted">{t('noFiles')}</li>
                  ) : (
                    files.map((attachment) => (
                      <li key={attachment.id} className="flex flex-wrap items-center gap-x-2">
                        <a
                          href={`/api/cases/${study.id}/attachments/${attachment.id}`}
                          className="text-brand-600 dark:text-brand-300 underline"
                        >
                          {attachment.fileName}
                        </a>
                        <span className="text-muted text-xs">
                          {Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB
                        </span>
                        {attachment.kind !== 'case' ? (
                          <span className="text-muted text-xs">
                            · {t(`kinds.${attachment.kind}`)}
                          </span>
                        ) : null}
                        {canEdit ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void removeFile(study.id, attachment.id, attachment.fileName)
                            }
                            className="ml-auto text-xs text-red-700 underline disabled:opacity-50 dark:text-red-300"
                          >
                            {t('removeFile')}
                          </button>
                        ) : null}
                      </li>
                    ))
                  )}
                </ul>

                {canEdit ? (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap items-end gap-3">
                      <Field label={t('fileKind')} htmlFor={`kind-${study.caseCode}`}>
                        <Select
                          id={`kind-${study.caseCode}`}
                          value={kinds[study.id] ?? 'case'}
                          onChange={(event) =>
                            setKinds((current) => ({
                              ...current,
                              [study.id]: event.target.value as CaseFileKind,
                            }))
                          }
                        >
                          {CASE_FILE_KINDS.filter((kind) => kind !== 'video').map((kind) => (
                            <option key={kind} value={kind}>
                              {t(`kinds.${kind}`)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <div className="min-w-[14rem] flex-1">
                        <input
                          ref={(element) => {
                            uploadInputs.current[study.id] = element;
                          }}
                          id={`upload-${study.caseCode}`}
                          type="file"
                          multiple
                          accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg"
                          disabled={busy}
                          aria-label={t('uploadLabel')}
                          onChange={(event) => {
                            const chosen = [...(event.target.files ?? [])];
                            if (chosen.length > 0) void upload(study.id, chosen);
                          }}
                          className="file:bg-brand-600 block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {study.status === 'archived' ? (
                        <Button variant="ghost" disabled={busy} onClick={() => restore(study)}>
                          {t('restore')}
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              void setStatus(
                                study.id,
                                study.status === 'published' ? 'draft' : 'published',
                              )
                            }
                          >
                            {study.status === 'published' ? t('unpublish') : t('publish')}
                          </Button>
                          <Button variant="ghost" disabled={busy} onClick={() => archive(study)}>
                            {t('archive')}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

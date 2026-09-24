'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LOCALES, currentAttachments, type CaseStudy } from '@casestudyhub/shared';
import { Link, useRouter } from '@/i18n/navigation';
import { Alert, Button, Field, Input, Select } from '@/components/ui/form';

export function CaseLibrary({
  cases,
  courses,
  canEdit,
}: {
  cases: CaseStudy[];
  courses: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const t = useTranslations('cases');
  const tError = useTranslations();
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const uploadInputs = useRef<Record<string, HTMLInputElement | null>>({});

  function reportError(payload: unknown) {
    const error = (
      payload as { error?: { messageKey?: string; details?: Record<string, unknown> } }
    )?.error;
    setErrorKey(error?.messageKey ?? 'errors.unexpected');
    setErrorDetail(
      error?.details ? Object.values(error.details).filter(Boolean).join(' · ') : null,
    );
  }

  async function createCase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setErrorKey(null);
    setNotice(null);
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

  async function upload(caseId: string, file: File) {
    setBusy(true);
    setErrorKey(null);
    setNotice(null);
    try {
      const body = new FormData();
      body.set('file', file);
      body.set('kind', 'case');

      const response = await fetch(`/api/cases/${caseId}/attachments`, { method: 'POST', body });
      if (!response.ok) {
        reportError(await response.json().catch(() => null));
        return;
      }
      setNotice(t('uploaded', { fileName: file.name }));
      const input = uploadInputs.current[caseId];
      if (input) input.value = '';
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(caseId: string, status: string) {
    setBusy(true);
    setErrorKey(null);
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

      {cases.length === 0 ? (
        <p className="text-muted text-sm">{t('empty')}</p>
      ) : (
        <ul className="space-y-4">
          {cases.map((study) => (
            <li key={study.id} className="surface-card rounded-xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">
                    <span className="font-mono text-sm">{study.caseCode}</span> — {study.title}
                  </h3>
                  {study.company ? <p className="text-muted text-sm">{study.company}</p> : null}
                  {study.cloIds.length > 0 ? (
                    <p className="text-muted mt-1 text-xs">{study.cloIds.join(' · ')}</p>
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
                <span
                  className={
                    study.status === 'published'
                      ? 'text-brand-600 dark:text-brand-300 text-sm font-medium'
                      : 'text-muted text-sm'
                  }
                >
                  {study.status === 'published' ? t('published') : t('draft')}
                </span>
              </div>

              <ul className="mt-3 space-y-1 text-sm">
                {currentAttachments(study.attachments).length === 0 ? (
                  <li className="text-muted">{t('noFiles')}</li>
                ) : (
                  currentAttachments(study.attachments).map((attachment) => (
                    <li key={attachment.id}>
                      <a
                        href={`/api/cases/${study.id}/attachments/${attachment.id}`}
                        className="text-brand-600 dark:text-brand-300 underline"
                      >
                        {attachment.fileName}
                      </a>
                      <span className="text-muted ml-2 text-xs">
                        {Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB
                      </span>
                    </li>
                  ))
                )}
              </ul>

              {canEdit ? (
                <div className="mt-4 space-y-3">
                  <input
                    ref={(element) => {
                      uploadInputs.current[study.id] = element;
                    }}
                    id={`upload-${study.caseCode}`}
                    type="file"
                    accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg"
                    disabled={busy}
                    aria-label={t('uploadLabel')}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void upload(study.id, file);
                    }}
                    className="file:bg-brand-600 block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
                  />
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void setStatus(study.id, study.status === 'published' ? 'draft' : 'published')
                    }
                  >
                    {study.status === 'published' ? t('unpublish') : t('publish')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { LOCALES, nextCaseCodes, titleFromFileName } from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button, Field, Input, Select } from '@/components/ui/form';

interface Outcome {
  fileName: string;
  code: string;
  ok: boolean;
  messageKey?: string;
}

/**
 * Many case files in, one draft case each out.
 *
 * Every case is a draft: the lecturer still reads the title, fixes it if the
 * file name was not a good one, and publishes. Nothing reaches a student here.
 */
export function BulkCreate({
  courses,
  existingCodes,
  busy,
  onBusy,
}: {
  courses: { id: string; name: string }[];
  existingCodes: string[];
  busy: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const t = useTranslations('cases');
  const tError = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [prefix, setPrefix] = useState('CASE');
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);

  const codes = nextCaseCodes(prefix, existingCodes, files.length);

  async function run(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (files.length === 0) return;
    const form = new FormData(event.currentTarget);
    const courseId = String(form.get('bulkCourseId') ?? '');
    const language = String(form.get('bulkLanguage') ?? 'en');
    const cloIds = String(form.get('bulkCloIds') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    onBusy(true);
    const results: Outcome[] = [];
    try {
      for (const [index, file] of files.entries()) {
        const code = codes[index]!;
        const created = await fetch('/api/cases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            caseCode: code,
            title: titleFromFileName(file.name),
            courseId,
            language,
            cloIds,
          }),
        });
        const payload = (await created.json().catch(() => null)) as {
          caseId?: string;
          error?: { messageKey?: string };
        } | null;
        if (!created.ok || !payload?.caseId) {
          results.push({
            fileName: file.name,
            code,
            ok: false,
            messageKey: payload?.error?.messageKey,
          });
          continue;
        }

        const body = new FormData();
        body.set('file', file);
        body.set('kind', 'case');
        const uploaded = await fetch(`/api/cases/${payload.caseId}/attachments`, {
          method: 'POST',
          body,
        });
        const problem = uploaded.ok
          ? undefined
          : (
              (await uploaded.json().catch(() => null)) as {
                error?: { messageKey?: string };
              } | null
            )?.error?.messageKey;
        results.push({ fileName: file.name, code, ok: uploaded.ok, messageKey: problem });
        setOutcomes([...results]);
      }
      setOutcomes(results);
      setFiles([]);
      router.refresh();
    } finally {
      onBusy(false);
    }
  }

  if (!open) {
    return (
      <div>
        <Button variant="ghost" onClick={() => setOpen(true)}>
          {t('bulkOpen')}
        </Button>
      </div>
    );
  }

  const created = outcomes.filter((row) => row.ok).length;

  return (
    <form
      onSubmit={run}
      className="surface-card space-y-4 rounded-xl p-4"
      data-testid="bulk-create"
    >
      <h2 className="font-semibold">{t('bulkTitle')}</h2>
      <p className="text-muted text-sm">{t('bulkHint')}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('bulkFiles')} htmlFor="bulkFiles">
          <input
            id="bulkFiles"
            type="file"
            multiple
            accept=".pdf,.docx,.pptx"
            disabled={busy}
            onChange={(event) => {
              setOutcomes([]);
              setFiles([...(event.target.files ?? [])]);
            }}
            className="file:bg-brand-600 block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
          />
        </Field>
        <Field label={t('bulkPrefix')} htmlFor="bulkPrefix" hint={t('bulkPrefixHint')}>
          <Input
            id="bulkPrefix"
            value={prefix}
            onChange={(event) => setPrefix(event.target.value)}
          />
        </Field>
        <Field label={t('course')} htmlFor="bulkCourseId">
          <Select id="bulkCourseId" name="bulkCourseId" required>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('language')} htmlFor="bulkLanguage">
          <Select id="bulkLanguage" name="bulkLanguage" defaultValue="en">
            {LOCALES.map((value) => (
              <option key={value} value={value}>
                {value === 'vi' ? 'Tiếng Việt' : 'English'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('clos')} htmlFor="bulkCloIds" hint={t('closHint')}>
          <Input id="bulkCloIds" name="bulkCloIds" placeholder="CLO1, CLO2, CLO4, CLO6" />
        </Field>
      </div>

      {files.length > 0 ? (
        <ul className="space-y-1 text-sm" data-testid="bulk-preview">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <span className="font-mono text-xs">{codes[index]}</span> —{' '}
              {titleFromFileName(file.name)}{' '}
              <span className="text-muted text-xs">({file.name})</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || files.length === 0}>
          {t('bulkCreate', { count: files.length })}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          {t('cancelEdit')}
        </Button>
      </div>

      {outcomes.length > 0 ? (
        <div className="space-y-2">
          {created > 0 ? <Alert tone="success">{t('bulkDone', { count: created })}</Alert> : null}
          {outcomes
            .filter((row) => !row.ok)
            .map((row) => (
              <Alert key={row.fileName} tone="error">
                {row.fileName} ({row.code}): {tError(row.messageKey ?? 'errors.unexpected')}
              </Alert>
            ))}
        </div>
      ) : null}
    </form>
  );
}

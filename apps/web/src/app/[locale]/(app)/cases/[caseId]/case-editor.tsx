'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { CaseStudy, CaseVersion } from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { Alert, Button, Field, Input } from '@/components/ui/form';

/**
 * Revising a case, and the record of every revision before it.
 *
 * An edit never overwrites: it writes a new version and moves the case's
 * pointer. A group set this case in March keeps reading what they were given,
 * whatever is rewritten in June - the same promise the assessment framework
 * makes, for the same reason.
 */
export function CaseEditor({
  caseStudy,
  versions,
}: {
  caseStudy: CaseStudy;
  versions: CaseVersion[];
}) {
  const t = useTranslations('cases');
  const tError = useTranslations();
  const format = useFormatter();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [savedVersion, setSavedVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** One per line is how a lecturer types a list; the API wants an array. */
  const lines = (value: FormDataEntryValue | null): string[] =>
    String(value ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    setBusy(true);
    setErrorKey(null);
    setSavedVersion(null);

    try {
      const response = await fetch(`/api/cases/${caseStudy.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: String(form.get('title') ?? ''),
          subtitle: String(form.get('subtitle') ?? '') || undefined,
          company: String(form.get('company') ?? '') || undefined,
          industry: String(form.get('industry') ?? '') || undefined,
          chapter: String(form.get('chapter') ?? '') || undefined,
          description: String(form.get('description') ?? '') || undefined,
          learningObjectives: lines(form.get('learningObjectives')),
          cloIds: lines(form.get('cloIds')),
          mainQuestions: lines(form.get('mainQuestions')),
          supportingQuestions: lines(form.get('supportingQuestions')),
          references: lines(form.get('references')),
          reason: String(form.get('reason') ?? ''),
        }),
      });

      if (!response.ok) {
        const body = (await response.json()) as {
          error?: { messageKey?: string; details?: { fields?: { messageKey: string }[] } };
        };
        setErrorKey(
          body.error?.details?.fields?.[0]?.messageKey ??
            body.error?.messageKey ??
            'errors.unexpected',
        );
        return;
      }

      const { versionId } = (await response.json()) as { versionId: string };
      setSavedVersion(versionId);
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const area =
    'h-24 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-sm';

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>{t('revisionsTitle')}</CardTitle>
        <div className="flex items-center gap-2">
          <Badge tone="brand">{caseStudy.currentVersionId ?? 'v1'}</Badge>
          <Button variant="ghost" onClick={() => setOpen((value) => !value)}>
            {open ? t('cancelEdit') : t('edit')}
          </Button>
        </div>
      </div>
      <p className="text-muted mt-2 text-sm">{t('revisionsBody')}</p>

      {savedVersion ? (
        <div className="mt-4">
          <Alert tone="success">{t('revised', { version: savedVersion })}</Alert>
        </div>
      ) : null}

      {open ? (
        <form onSubmit={save} className="mt-4 space-y-4" data-testid="case-editor">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('caseTitle')} htmlFor="title">
              <Input
                id="title"
                name="title"
                defaultValue={caseStudy.title}
                required
                minLength={2}
              />
            </Field>
            <Field label={t('caseSubtitle')} htmlFor="subtitle">
              <Input id="subtitle" name="subtitle" defaultValue={caseStudy.subtitle ?? ''} />
            </Field>
            <Field label={t('company')} htmlFor="company">
              <Input id="company" name="company" defaultValue={caseStudy.company ?? ''} />
            </Field>
            <Field label={t('industry')} htmlFor="industry">
              <Input id="industry" name="industry" defaultValue={caseStudy.industry ?? ''} />
            </Field>
            <Field label={t('chapter')} htmlFor="chapter">
              <Input id="chapter" name="chapter" defaultValue={caseStudy.chapter ?? ''} />
            </Field>
          </div>

          <Field label={t('description')} htmlFor="description">
            <textarea
              id="description"
              name="description"
              className={area}
              defaultValue={caseStudy.description ?? ''}
            />
          </Field>

          {(
            [
              ['mainQuestions', caseStudy.mainQuestions],
              ['supportingQuestions', caseStudy.supportingQuestions],
              ['learningObjectives', caseStudy.learningObjectives],
              ['cloIds', caseStudy.cloIds],
              ['references', caseStudy.references],
            ] as const
          ).map(([name, value]) => (
            <Field key={name} label={t(name)} htmlFor={name} hint={t('onePerLine')}>
              <textarea
                id={name}
                name={name}
                className={area}
                defaultValue={[...value].join('\n')}
              />
            </Field>
          ))}

          <Field label={t('reason')} htmlFor="reason" hint={t('reasonHint')}>
            <Input id="reason" name="reason" required minLength={10} maxLength={500} />
          </Field>

          {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}

          <Button type="submit" disabled={busy}>
            {t('saveRevision')}
          </Button>
        </form>
      ) : null}

      <ul className="mt-6 space-y-2 text-sm" data-testid="case-versions">
        {versions.map((version) => (
          <li key={version.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Badge tone={version.versionId === caseStudy.currentVersionId ? 'brand' : 'neutral'}>
              {version.versionId}
            </Badge>
            <span className="font-medium">{version.title}</span>
            <span className="text-muted">{version.reason || t('firstVersion')}</span>
            <span className="text-muted ml-auto text-xs tabular-nums">
              {format.dateTime(new Date(version.createdAt), { dateStyle: 'medium' })}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-muted mt-4 text-xs">{t('attachmentsNotVersioned')}</p>
    </Card>
  );
}

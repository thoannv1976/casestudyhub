'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { LOCALES, type NamedOption } from '@/lib/types';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button, Field, Input, Select } from '@/components/ui/form';

/**
 * Three short forms rather than a wizard: an administrator sets the structure
 * up once a year, and a wizard would hide which level they are editing.
 */
export function AcademicAdmin({
  years,
  semesters,
}: {
  years: NamedOption[];
  semesters: NamedOption[];
}) {
  const t = useTranslations('academicAdmin');
  const tAuth = useTranslations('auth');
  const tError = useTranslations();
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [doneKey, setDoneKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(body: Record<string, unknown>, successKey: string) {
    setBusy(true);
    setErrorKey(null);
    setDoneKey(null);
    try {
      const response = await fetch('/api/admin/academic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setErrorKey(payload?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      setDoneKey(successKey);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}
      {doneKey ? <Alert tone="success">{t(doneKey)}</Alert> : null}

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void create(
            {
              kind: 'academicYear',
              name: String(form.get('name') ?? ''),
              startDate: String(form.get('startDate') ?? ''),
              endDate: String(form.get('endDate') ?? ''),
            },
            'yearCreated',
          );
        }}
      >
        <h2 className="text-lg font-semibold">{t('yearTitle')}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('yearName')} htmlFor="yearName">
            <Input id="yearName" name="name" placeholder="2026–2027" required />
          </Field>
          <Field label={t('startDate')} htmlFor="startDate">
            <Input id="startDate" name="startDate" type="date" required />
          </Field>
          <Field label={t('endDate')} htmlFor="endDate">
            <Input id="endDate" name="endDate" type="date" required />
          </Field>
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? tAuth('working') : t('addYear')}
        </Button>
      </form>

      <form
        className="space-y-4 border-t border-[var(--border-subtle)] pt-8"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void create(
            {
              kind: 'semester',
              academicYearId: String(form.get('academicYearId') ?? ''),
              name: String(form.get('name') ?? ''),
            },
            'semesterCreated',
          );
        }}
      >
        <h2 className="text-lg font-semibold">{t('semesterTitle')}</h2>
        {years.length === 0 ? (
          <Alert tone="error">{t('needsYear')}</Alert>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('academicYear')} htmlFor="academicYearId">
                <Select id="academicYearId" name="academicYearId" required>
                  {years.map((year) => (
                    <option key={year.id} value={year.id}>
                      {year.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('semesterName')} htmlFor="semesterName">
                <Input id="semesterName" name="name" placeholder="Fall 2026" required />
              </Field>
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? tAuth('working') : t('addSemester')}
            </Button>
          </>
        )}
      </form>

      <form
        className="space-y-4 border-t border-[var(--border-subtle)] pt-8"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const clos = String(form.get('cloIds') ?? '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);
          void create(
            {
              kind: 'course',
              code: String(form.get('code') ?? ''),
              name: String(form.get('name') ?? ''),
              defaultLanguage: String(form.get('defaultLanguage') ?? 'vi'),
              cloIds: clos,
            },
            'courseCreated',
          );
        }}
      >
        <h2 className="text-lg font-semibold">{t('courseTitle')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('courseCode')} htmlFor="courseCode">
            <Input id="courseCode" name="code" placeholder="ECOM2026" required />
          </Field>
          <Field label={t('courseName')} htmlFor="courseName">
            <Input id="courseName" name="name" placeholder="E-Commerce 2026" required />
          </Field>
          <Field label={t('clos')} htmlFor="cloIds" hint={t('closHint')}>
            <Input id="cloIds" name="cloIds" placeholder="CLO1, CLO2, CLO4, CLO6" />
          </Field>
          <Field label={t('defaultLanguage')} htmlFor="defaultLanguage">
            <Select id="defaultLanguage" name="defaultLanguage">
              {LOCALES.map((value) => (
                <option key={value} value={value}>
                  {value === 'vi' ? 'Tiếng Việt' : 'English'}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? tAuth('working') : t('addCourse')}
        </Button>
      </form>

      {semesters.length > 0 ? (
        <p className="text-muted text-xs">{t('semesterCount', { count: semesters.length })}</p>
      ) : null}
    </div>
  );
}

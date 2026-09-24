'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { LOCALES, createClassSchema, type CreateClassInput } from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button, Field, Input, Select } from '@/components/ui/form';

const LOCALE_LABELS: Record<string, string> = { vi: 'Tiếng Việt', en: 'English' };

export function CreateClassForm({
  courses,
  semesters,
}: {
  courses: { id: string; name: string }[];
  semesters: { id: string; name: string }[];
}) {
  const t = useTranslations('teaching');
  const tAuth = useTranslations('auth');
  const tError = useTranslations();
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateClassInput>({
    resolver: zodResolver(createClassSchema),
    defaultValues: {
      classCode: '',
      className: '',
      courseId: courses[0]?.id ?? '',
      semesterId: semesters[0]?.id ?? '',
      language: 'vi',
      joinMode: 'code',
      lecturerIds: [],
    },
  });

  async function onSubmit(values: CreateClassInput) {
    setErrorKey(null);
    setCreated(false);

    const response = await fetch('/api/classes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...values, classCode: values.classCode.toUpperCase() }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setErrorKey(body?.error?.messageKey ?? 'errors.unexpected');
      return;
    }

    setCreated(true);
    reset();
    router.refresh();
  }

  const messageFor = (key?: string) =>
    key ? tError(key.startsWith('errors.') ? key : 'errors.validationFailed') : undefined;

  if (courses.length === 0 || semesters.length === 0) {
    return <Alert tone="error">{t('needsCourseAndSemester')}</Alert>;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}
      {created ? <Alert tone="success">{t('classCreated')}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t('classCode')}
          htmlFor="classCode"
          hint={t('classCodeHint')}
          error={messageFor(errors.classCode?.message)}
        >
          <Input
            id="classCode"
            placeholder="ECOM-2026-A01"
            className="uppercase"
            aria-invalid={errors.classCode ? 'true' : 'false'}
            {...register('classCode')}
          />
        </Field>

        <Field
          label={t('className')}
          htmlFor="className"
          error={messageFor(errors.className?.message)}
        >
          <Input
            id="className"
            placeholder="E-Commerce 2026 – A01"
            aria-invalid={errors.className ? 'true' : 'false'}
            {...register('className')}
          />
        </Field>

        <Field label={t('course')} htmlFor="courseId">
          <Select id="courseId" {...register('courseId')}>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('semester')} htmlFor="semesterId">
          <Select id="semesterId" {...register('semesterId')}>
            {semesters.map((semester) => (
              <option key={semester.id} value={semester.id}>
                {semester.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('language')} htmlFor="language">
          <Select id="language" {...register('language')}>
            {LOCALES.map((value) => (
              <option key={value} value={value}>
                {LOCALE_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('joinMode')} htmlFor="joinMode" hint={t('joinModeHint')}>
          <Select id="joinMode" {...register('joinMode')}>
            <option value="code">{t('joinModeCode')}</option>
            <option value="approval">{t('joinModeApproval')}</option>
            <option value="closed">{t('joinModeClosed')}</option>
          </Select>
        </Field>
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? tAuth('working') : t('createClass')}
      </Button>
    </form>
  );
}

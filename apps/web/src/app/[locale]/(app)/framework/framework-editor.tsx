'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { nextVersionAfter, type PresentationPolicy } from '@casestudyhub/shared';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { Alert, Button, Field, Input, Select } from '@/components/ui/form';

/**
 * Editing a framework by publishing the next version of it.
 *
 * The form starts from an existing version and changes numbers on a copy. It
 * never offers to save over what it started from, because a version a mark was
 * computed from must stay exactly as it was - the server refuses it anyway,
 * and an interface that offered it would be lying about what happens.
 *
 * Roles, the slide skeleton and the rubric's wording are carried across
 * unchanged. What a faculty adjusts between terms is the numbers: how long a
 * group speaks, how many questions the class owes, what a criterion is worth.
 */
export function FrameworkEditor({
  policies,
  canVersionShared,
}: {
  policies: PresentationPolicy[];
  /** Only an administrator may add a version to a framework others run under. */
  canVersionShared: boolean;
}) {
  const t = useTranslations('framework');
  const tRubric = useTranslations('rubric');
  const tError = useTranslations();
  const router = useRouter();

  const [baseKey, setBaseKey] = useState(`${policies[0]?.id}__${policies[0]?.version}`);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const base =
    policies.find((policy) => `${policy.id}__${policy.version}` === baseKey) ?? policies[0];
  if (!base) return <Alert tone="error">{tError('errors.policyNotFound')}</Alert>;

  async function publish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!base) return;

    const form = new FormData(event.currentTarget);
    const number = (name: string, fallback: number) => {
      const raw = form.get(name);
      const value = Number(raw);
      return raw === null || raw === '' || Number.isNaN(value) ? fallback : value;
    };

    // Built by changing a copy of the version on screen, so anything the form
    // does not offer - roles, the slide skeleton, criterion wording - is
    // carried across exactly rather than reinvented.
    const policy: PresentationPolicy = {
      ...base,
      id: String(form.get('frameworkId') ?? base.id).trim() || base.id,
      version: String(form.get('version') ?? '').trim(),
      presentation: {
        minMinutes: number('minMinutes', base.presentation.minMinutes),
        maxMinutes: number('maxMinutes', base.presentation.maxMinutes),
        hardStopMinutes: number('hardStopMinutes', base.presentation.hardStopMinutes),
      },
      qa: {
        ...base.qa,
        minClassQuestions: number('minClassQuestions', base.qa.minClassQuestions),
      },
      submission: {
        ...base.submission,
        deadlineHoursBeforeSession: number(
          'deadlineHours',
          base.submission.deadlineHoursBeforeSession,
        ),
      },
      grading: {
        ...base.grading,
        teamWeight: number('teamWeight', base.grading.teamWeight * 100) / 100,
        individualWeight: 1 - number('teamWeight', base.grading.teamWeight * 100) / 100,
        lateSubmissionPenaltyPoints: number(
          'latePenalty',
          base.grading.lateSubmissionPenaltyPoints,
        ),
        decimals: number('decimals', base.grading.decimals),
      },
      rubric: (() => {
        const criteria = base.rubric.criteria.map((criterion) => ({
          ...criterion,
          maxPoints: number(`criterion__${criterion.id}`, criterion.maxPoints),
        }));
        // The total is the sum of the parts, not a separate decision. The
        // schema refuses a rubric where the two disagree, so a form that asked
        // for both would be a form that could only be filled in wrongly.
        return {
          ...base.rubric,
          totalPoints: criteria.reduce((sum, criterion) => sum + criterion.maxPoints, 0),
          criteria,
        };
      })(),
    };

    setBusy(true);
    setErrorKey(null);
    setSaved(false);

    try {
      const response = await fetch('/api/policies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ policy, reason: String(form.get('reason') ?? '') }),
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

      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const rubricTotal = base.rubric.criteria.reduce(
    (total, criterion) => total + criterion.maxPoints,
    0,
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle>{t('versionsTitle')}</CardTitle>
        <p className="text-muted mt-2 text-sm">{t('versionsBody')}</p>
        <ul className="mt-4 space-y-2 text-sm" data-testid="framework-versions">
          {policies.map((policy) => (
            <li key={`${policy.id}__${policy.version}`} className="flex flex-wrap gap-2">
              <span className="font-mono text-xs">{policy.id}</span>
              <Badge tone={policy.version === base.version ? 'brand' : 'neutral'}>
                {policy.version}
              </Badge>
              <span className="text-muted">
                {t('summary', {
                  minutes: policy.presentation.maxMinutes,
                  questions: policy.qa.minClassQuestions,
                  team: Math.round(policy.grading.teamWeight * 100),
                })}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <form onSubmit={publish} className="space-y-6">
        <Card>
          <CardTitle>{t('basedOn')}</CardTitle>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label={t('baseVersion')} htmlFor="baseKey">
              <Select
                id="baseKey"
                name="baseKey"
                value={baseKey}
                onChange={(event) => setBaseKey(event.target.value)}
              >
                {policies.map((policy) => (
                  <option
                    key={`${policy.id}__${policy.version}`}
                    value={`${policy.id}__${policy.version}`}
                  >
                    {policy.id} · {policy.version}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('frameworkId')}
              htmlFor="frameworkId"
              hint={canVersionShared ? t('frameworkIdHint') : t('frameworkIdHintLecturer')}
            >
              <Input id="frameworkId" name="frameworkId" defaultValue={base.id} required />
            </Field>
            <Field label={t('newVersion')} htmlFor="version" hint={t('newVersionHint')}>
              <Input
                id="version"
                name="version"
                defaultValue={nextVersionAfter(base.version)}
                required
              />
            </Field>
          </div>
        </Card>

        <Card>
          <CardTitle>{t('timingTitle')}</CardTitle>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label={t('minMinutes')} htmlFor="minMinutes">
              <Input
                id="minMinutes"
                name="minMinutes"
                type="number"
                min={1}
                step={1}
                defaultValue={base.presentation.minMinutes}
              />
            </Field>
            <Field label={t('maxMinutes')} htmlFor="maxMinutes">
              <Input
                id="maxMinutes"
                name="maxMinutes"
                type="number"
                min={1}
                step={1}
                defaultValue={base.presentation.maxMinutes}
              />
            </Field>
            <Field label={t('hardStopMinutes')} htmlFor="hardStopMinutes" hint={t('hardStopHint')}>
              <Input
                id="hardStopMinutes"
                name="hardStopMinutes"
                type="number"
                min={1}
                step={1}
                defaultValue={base.presentation.hardStopMinutes}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <CardTitle>{t('rulesTitle')}</CardTitle>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t('minClassQuestions')} htmlFor="minClassQuestions">
              <Input
                id="minClassQuestions"
                name="minClassQuestions"
                type="number"
                min={0}
                step={1}
                defaultValue={base.qa.minClassQuestions}
              />
            </Field>
            <Field label={t('deadlineHours')} htmlFor="deadlineHours">
              <Input
                id="deadlineHours"
                name="deadlineHours"
                type="number"
                min={0}
                step={1}
                defaultValue={base.submission.deadlineHoursBeforeSession}
              />
            </Field>
            <Field label={t('latePenalty')} htmlFor="latePenalty">
              <Input
                id="latePenalty"
                name="latePenalty"
                type="number"
                min={0}
                step={1}
                defaultValue={base.grading.lateSubmissionPenaltyPoints}
              />
            </Field>
            <Field label={t('decimals')} htmlFor="decimals">
              <Input
                id="decimals"
                name="decimals"
                type="number"
                min={0}
                max={3}
                step={1}
                defaultValue={base.grading.decimals}
              />
            </Field>
            <Field label={t('teamWeight')} htmlFor="teamWeight" hint={t('teamWeightHint')}>
              <Input
                id="teamWeight"
                name="teamWeight"
                type="number"
                min={0}
                max={100}
                step={1}
                defaultValue={Math.round(base.grading.teamWeight * 100)}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <CardTitle>{t('rubricTitle')}</CardTitle>
          <p className="text-muted mt-2 text-sm">{t('rubricBody', { total: rubricTotal })}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {base.rubric.criteria.map((criterion) => (
              <Field
                key={criterion.id}
                label={tRubric(criterion.key.replace(/^rubric\./, ''))}
                htmlFor={`criterion__${criterion.id}`}
              >
                <Input
                  id={`criterion__${criterion.id}`}
                  name={`criterion__${criterion.id}`}
                  type="number"
                  min={1}
                  step={1}
                  defaultValue={criterion.maxPoints}
                />
              </Field>
            ))}
          </div>
        </Card>

        <Card>
          <CardTitle>{t('reasonTitle')}</CardTitle>
          <p className="text-muted mt-2 text-sm">{t('reasonBody')}</p>
          <div className="mt-4">
            <Field label={t('reason')} htmlFor="reason">
              <Input id="reason" name="reason" required minLength={10} maxLength={500} />
            </Field>
          </div>
        </Card>

        {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}
        {saved ? <Alert tone="success">{t('published')}</Alert> : null}

        <Button type="submit" disabled={busy}>
          {t('publish')}
        </Button>
      </form>
    </div>
  );
}

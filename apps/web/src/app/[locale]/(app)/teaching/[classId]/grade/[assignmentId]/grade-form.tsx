'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { roleKeyOf, type LecturerAssessment, type PresentationPolicy } from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Alert, Button, Field, Input } from '@/components/ui/form';
import { Badge } from '@/components/ui/card';

interface Member {
  studentUid: string;
  studentId: string;
  fullName: string;
  roleIds: string[];
}

interface PreviewRow {
  studentUid: string;
  fullName: string;
  breakdown: {
    groupScoreAfterPenalty: number;
    latePenaltyApplied: number;
    individualScoreApplied: number;
    individualForfeited: boolean;
    forfeitReason: string | null;
    finalScore: number;
    policyVersion: string;
  };
}

/**
 * Marking, then publishing - two steps, on purpose.
 *
 * Saving computes what every member would get and shows it. Nothing reaches a
 * student until the lecturer publishes, and publishing a group is all or
 * nothing: a student told to wait while their group-mate already sees a mark
 * has no way to find out why.
 */
export function GradeForm({
  assignmentId,
  members,
  assessment,
  policy,
  isLate,
  canPublish,
}: {
  assignmentId: string;
  members: Member[];
  assessment: LecturerAssessment | null;
  /** Handed down by the page: the version this assignment froze. */
  policy: PresentationPolicy;
  isLate: boolean;
  canPublish: boolean;
}) {
  const t = useTranslations('grading');
  const tRubric = useTranslations('rubric');
  const tRoles = useTranslations('roles');
  const tError = useTranslations();
  const router = useRouter();

  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [waiving, setWaiving] = useState(assessment?.latePenaltyWaived ?? false);

  const published = assessment?.status === 'published';

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setErrorKey(null);

    try {
      const body = {
        criterionScores: Object.fromEntries(
          policy.rubric.criteria.map((criterion) => [criterion.id, Number(form.get(criterion.id))]),
        ),
        comment: String(form.get('comment') ?? '') || undefined,
        latePenaltyWaived: form.get('latePenaltyWaived') === 'on',
        latePenaltyWaiverReason: String(form.get('latePenaltyWaiverReason') ?? '') || undefined,
        individual: Object.fromEntries(
          members.map((member) => [
            member.studentUid,
            {
              rawScore: Number(form.get(`score_${member.studentUid}`)),
              didNotPresent: form.get(`absent_${member.studentUid}`) === 'on',
              failedOwnRoleQuestion: form.get(`failed_${member.studentUid}`) === 'on',
              note: String(form.get(`note_${member.studentUid}`) ?? '') || undefined,
            },
          ]),
        ),
      };

      const response = await fetch(`/api/assignments/${assignmentId}/assessment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setErrorKey(payload?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      setPreview(payload.preview ?? []);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    setErrorKey(null);
    try {
      const response = await fetch(`/api/assignments/${assignmentId}/assessment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish' }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setErrorKey(payload?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (published) {
    return (
      <div className="space-y-3">
        <Alert tone="success">{t('publishedNotice')}</Alert>
        <p className="text-muted text-sm">
          {t('publishedDetail', {
            score: assessment.groupScoreRaw,
            when: assessment.publishedAt?.slice(0, 10) ?? '',
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}

      <form onSubmit={save} className="space-y-6">
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">
            {t('groupScore', { max: policy.rubric.totalPoints })}
          </legend>
          {policy.rubric.criteria.map((criterion) => (
            <Field
              key={criterion.id}
              label={`${tRubric(criterion.key.replace(/^rubric\./, ''))} · ${criterion.maxPoints}`}
              htmlFor={criterion.id}
              hint={criterion.aiAssessable ? undefined : t('lecturerOnlyCriterion')}
            >
              <Input
                id={criterion.id}
                name={criterion.id}
                type="number"
                min={0}
                max={criterion.maxPoints}
                step={0.5}
                required
                defaultValue={assessment?.criterionScores[criterion.id] ?? ''}
              />
            </Field>
          ))}

          <Field label={t('comment')} htmlFor="comment">
            <textarea
              id="comment"
              name="comment"
              rows={3}
              maxLength={4000}
              defaultValue={assessment?.comment ?? ''}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </Field>
        </fieldset>

        {isLate ? (
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold">
              {t('latePenalty', { points: policy.grading.lateSubmissionPenaltyPoints })}
            </legend>
            <label className="flex items-center gap-2 text-sm">
              <Input
                id="latePenaltyWaived"
                name="latePenaltyWaived"
                type="checkbox"
                defaultChecked={assessment?.latePenaltyWaived ?? false}
                onChange={(event) => setWaiving(event.currentTarget.checked)}
                className="h-4 w-4"
              />
              {t('waivePenalty')}
            </label>
            {waiving ? (
              <Field
                label={t('waiverReason')}
                htmlFor="latePenaltyWaiverReason"
                hint={t('waiverReasonHint')}
              >
                <Input
                  id="latePenaltyWaiverReason"
                  name="latePenaltyWaiverReason"
                  minLength={10}
                  required
                  defaultValue={assessment?.latePenaltyWaiverReason ?? ''}
                />
              </Field>
            ) : null}
          </fieldset>
        ) : null}

        <fieldset className="space-y-4">
          <legend className="text-sm font-semibold">
            {t('individualScores', { weight: Math.round(policy.grading.individualWeight * 100) })}
          </legend>

          {members.length === 0 ? (
            <p className="text-muted text-sm">{t('noMembers')}</p>
          ) : (
            members.map((member) => (
              <div key={member.studentUid} className="surface-card space-y-3 rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{member.fullName}</span>
                  <span className="text-muted font-mono text-xs">{member.studentId}</span>
                  {member.roleIds.map((roleId) => (
                    <Badge key={roleId} tone="accent">
                      {roleId} · {tRoles(`${roleKeyOf(roleId)}.title`)}
                    </Badge>
                  ))}
                </div>

                <Field
                  label={t('individualScore', { max: policy.grading.maxScore })}
                  htmlFor={`score_${member.studentUid}`}
                >
                  <Input
                    id={`score_${member.studentUid}`}
                    name={`score_${member.studentUid}`}
                    type="number"
                    min={0}
                    max={policy.grading.maxScore}
                    step={0.5}
                    required
                    defaultValue={assessment?.individual[member.studentUid]?.rawScore ?? ''}
                  />
                </Field>

                <label className="flex items-center gap-2 text-sm">
                  <Input
                    id={`absent_${member.studentUid}`}
                    name={`absent_${member.studentUid}`}
                    type="checkbox"
                    defaultChecked={
                      assessment?.individual[member.studentUid]?.didNotPresent ?? false
                    }
                    className="h-4 w-4"
                  />
                  {t('didNotPresent')}
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <Input
                    id={`failed_${member.studentUid}`}
                    name={`failed_${member.studentUid}`}
                    type="checkbox"
                    defaultChecked={
                      assessment?.individual[member.studentUid]?.failedOwnRoleQuestion ?? false
                    }
                    className="h-4 w-4"
                  />
                  {t('failedOwnRoleQuestion')}
                </label>

                <Field label={t('note')} htmlFor={`note_${member.studentUid}`}>
                  <Input
                    id={`note_${member.studentUid}`}
                    name={`note_${member.studentUid}`}
                    maxLength={1000}
                    defaultValue={assessment?.individual[member.studentUid]?.note ?? ''}
                  />
                </Field>
              </div>
            ))
          )}
        </fieldset>

        <Button type="submit" disabled={busy}>
          {t('save')}
        </Button>
      </form>

      {preview.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold">{t('previewTitle')}</h4>
          <p className="text-muted mt-1 text-sm">
            {t('previewHint', {
              team: Math.round(policy.grading.teamWeight * 100),
              individual: Math.round(policy.grading.individualWeight * 100),
            })}
          </p>
          <ul data-testid="grade-preview" className="mt-3 space-y-2">
            {preview.map((row) => (
              <li
                key={row.studentUid}
                className="surface-card flex flex-wrap items-center justify-between gap-2 rounded-xl p-3 text-sm"
              >
                <span>{row.fullName}</span>
                <span className="flex flex-wrap items-center gap-2">
                  {row.breakdown.latePenaltyApplied > 0 ? (
                    <Badge>
                      {t('penaltyApplied', { points: row.breakdown.latePenaltyApplied })}
                    </Badge>
                  ) : null}
                  {row.breakdown.individualForfeited ? (
                    <Badge>{t(`forfeit.${row.breakdown.forfeitReason ?? 'absent'}`)}</Badge>
                  ) : null}
                  <span className="font-semibold tabular-nums">{row.breakdown.finalScore}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canPublish ? (
        <div className="space-y-2 border-t border-[var(--border-subtle)] pt-4">
          <p className="text-muted text-sm">{t('publishHint')}</p>
          <Button disabled={busy || !assessment} onClick={() => void publish()}>
            {t('publish')}
          </Button>
        </div>
      ) : (
        <p className="text-muted border-t border-[var(--border-subtle)] pt-4 text-sm">
          {t('publishIsLecturerOnly')}
        </p>
      )}
    </div>
  );
}

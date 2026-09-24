'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { withoutCitations, type AiAssessment } from '@casestudyhub/shared';
import { Alert, Button } from '@/components/ui/form';
import { Badge } from '@/components/ui/card';

/**
 * The model's reading of the documents, beside the lecturer's own marking.
 *
 * Nothing here fills a field. Each suggestion is shown with what it was read
 * from - a slide or a page, and the words - so the lecturer can check the
 * claim rather than trust it; the criterion judged in the room is absent
 * because the model was never asked about it. Suggestions with nothing to
 * point at are called out as exactly that.
 */
export function AiPanel({
  assignmentId,
  available,
  initial,
}: {
  assignmentId: string;
  available: boolean;
  initial: AiAssessment | null;
}) {
  const t = useTranslations('ai');
  const tRubric = useTranslations('rubric');
  const tError = useTranslations();

  const [assessment, setAssessment] = useState(initial);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!available) {
    return <p className="text-muted text-sm">{t('notConfigured')}</p>;
  }

  async function run() {
    setBusy(true);
    setErrorKey(null);
    try {
      const response = await fetch(`/api/assignments/${assignmentId}/ai-assessment`, {
        method: 'POST',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setErrorKey(payload?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      setAssessment(payload.assessment);
    } finally {
      setBusy(false);
    }
  }

  const uncited = assessment ? withoutCitations(assessment.criteria) : [];

  return (
    <div className="space-y-4">
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}

      <p className="text-muted text-sm">{t('advisory')}</p>

      <Button disabled={busy} onClick={() => void run()}>
        {busy ? t('reading') : assessment ? t('rerun') : t('run')}
      </Button>

      {assessment ? (
        <div className="space-y-4">
          <p className="text-sm">
            {t('suggestedTotal', {
              total: assessment.suggestedTotal,
              max: assessment.assessableMaxPoints,
            })}
            <span className="text-muted ml-2 text-xs">
              {t('by', {
                model: assessment.model,
                seconds: (assessment.latencyMs / 1000).toFixed(1),
              })}
            </span>
          </p>

          {uncited.length > 0 ? (
            <Alert tone="error">{t('uncitedWarning', { count: uncited.length })}</Alert>
          ) : null}

          <ul className="space-y-3">
            {assessment.criteria.map((criterion) => (
              <li key={criterion.criterionId} className="surface-card rounded-xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {tRubric(`criteria.${criterion.criterionId}`)}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge>{t(`confidence.${criterion.confidence}`)}</Badge>
                    <span className="font-semibold tabular-nums">
                      {criterion.suggestedPoints} / {criterion.maxPoints}
                    </span>
                  </span>
                </div>

                <p className="mt-2 text-sm">{criterion.reasoning}</p>

                {criterion.citations.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {criterion.citations.map((citation, index) => (
                      <li
                        key={`${citation.locator}-${index}`}
                        className="border-brand-300 border-l-2 pl-3 text-xs"
                      >
                        <span className="text-muted">
                          {t(`source.${citation.source}`)} · {citation.locator}
                        </span>
                        <p className="mt-1 italic">“{citation.quote}”</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted mt-2 text-xs">{t('noCitation')}</p>
                )}
              </li>
            ))}
          </ul>

          {assessment.gaps.length > 0 ? (
            <div>
              <h4 className="text-sm font-semibold">{t('gaps')}</h4>
              <ul className="text-muted mt-2 list-disc space-y-1 pl-5 text-sm">
                {assessment.gaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

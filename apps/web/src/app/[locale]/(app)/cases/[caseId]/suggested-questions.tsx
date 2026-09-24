'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button } from '@/components/ui/form';
import { Badge } from '@/components/ui/card';

interface Suggestion {
  text: string;
  category: string;
  whyItIsWorthAsking: string;
}

/**
 * Questions the lecturer might put to a presenting group.
 *
 * Shown and never written anywhere. The question wall belongs to the class;
 * a wall that fills itself with the model's questions stops being theirs.
 */
export function SuggestedQuestions({ caseId, available }: { caseId: string; available: boolean }) {
  const t = useTranslations('suggestions');
  const tQuestions = useTranslations('questions');
  const tError = useTranslations();

  const [questions, setQuestions] = useState<Suggestion[]>([]);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!available) {
    return <p className="text-muted text-sm">{t('notConfigured')}</p>;
  }

  async function run() {
    setBusy(true);
    setErrorKey(null);
    try {
      const response = await fetch(`/api/cases/${caseId}/suggested-questions`, { method: 'POST' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setErrorKey(payload?.error?.messageKey ?? 'errors.unexpected');
        return;
      }
      setQuestions(payload.questions ?? []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {errorKey ? <Alert tone="error">{tError(errorKey)}</Alert> : null}
      <p className="text-muted text-sm">{t('hint')}</p>

      <Button disabled={busy} onClick={() => void run()}>
        {busy ? t('thinking') : questions.length > 0 ? t('again') : t('suggest')}
      </Button>

      {questions.length > 0 ? (
        <ul className="space-y-3">
          {questions.map((question) => (
            <li key={question.text} className="surface-card rounded-xl p-4">
              <Badge>{tQuestions(`categories.${question.category}`)}</Badge>
              <p className="mt-2 text-sm font-medium">{question.text}</p>
              <p className="text-muted mt-1 text-xs">{question.whyItIsWorthAsking}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

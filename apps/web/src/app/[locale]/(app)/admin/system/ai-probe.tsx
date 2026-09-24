'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AiProbe, AiStatus } from '@casestudyhub/core';
import type { SystemSettings } from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Badge, Card, CardTitle } from '@/components/ui/card';
import { Alert, Button } from '@/components/ui/form';

/**
 * Whether the model actually answers, and what it said when it did not.
 *
 * Every AI feature here is advisory, so "not configured" is a state the
 * interface reports rather than an error. The cost is that a real failure - a
 * wrong model name, a service account missing the role - looks identical from
 * the outside. This is the one screen that tells them apart.
 */
export function AiProbePanel({ status, settings }: { status: AiStatus; settings: SystemSettings }) {
  const t = useTranslations('systemAdmin');
  const router = useRouter();
  const [probe, setProbe] = useState<AiProbe | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  /**
   * Turning the model on and off is one request, not a deploy.
   *
   * It used to be an environment variable, and the deploy script replaced the
   * whole variable set rather than merging into it - so every release turned
   * the model off, silently, because "no model configured" is a normal state
   * here rather than an error.
   */
  async function setEnabled(aiEnabled: boolean) {
    setSaving(true);
    setProbe(null);
    try {
      await fetch('/api/admin/system', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          settings: { ...settings, aiEnabled },
          reason: aiEnabled ? 'Turned the model on.' : 'Turned the model off.',
        }),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function run() {
    setBusy(true);
    setProbe(null);
    try {
      const response = await fetch('/api/admin/ai', { method: 'POST' });
      if (!response.ok) {
        setProbe({ ok: false, reason: 'failed', detail: `HTTP ${response.status}` });
        return;
      }
      const body = (await response.json()) as { probe: AiProbe };
      setProbe(body.probe);
    } catch (error) {
      setProbe({ ok: false, reason: 'failed', detail: String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>{t('aiStatusTitle')}</CardTitle>
        <Badge tone={status.configured ? 'brand' : 'neutral'}>
          {status.configured ? t('aiOn') : t('aiOff')}
        </Badge>
      </div>
      <p className="text-muted mt-2 text-sm">{t('aiStatusBody')}</p>

      {status.configured ? (
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3" data-testid="ai-status">
          <div>
            <dt className="text-muted">{t('aiTransport')}</dt>
            <dd className="font-medium">
              {status.transport === 'vertex' ? t('aiVertex') : t('aiApiKey')}
            </dd>
          </div>
          <div>
            <dt className="text-muted">{t('aiModel')}</dt>
            <dd className="font-mono font-medium">{status.model}</dd>
          </div>
          <div>
            <dt className="text-muted">{t('aiLocation')}</dt>
            <dd className="font-mono font-medium">{status.location ?? '—'}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-4 text-sm">{t('aiOffHint')}</p>
      )}

      {/* An API key is a credential and lives in the environment, so this
          switch has nothing to offer when one is set. */}
      {status.transport === 'apiKey' ? null : (
        <div className="mt-4">
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => void setEnabled(!settings.aiEnabled)}
          >
            {settings.aiEnabled ? t('aiTurnOff') : t('aiTurnOn')}
          </Button>
          <p className="text-muted mt-2 text-xs">{t('aiToggleHint')}</p>
        </div>
      )}

      <div className="mt-4">
        <Button onClick={() => void run()} disabled={busy}>
          {busy ? t('aiProbing') : t('aiProbe')}
        </Button>
        <p className="text-muted mt-2 text-xs">{t('aiProbeCost')}</p>
      </div>

      {probe?.ok ? (
        <div className="mt-4" data-testid="ai-probe-result">
          <Alert tone="success">
            {t('aiProbeOk', {
              model: probe.model,
              answer: probe.answer,
              ms: probe.latencyMs,
              tokens: probe.promptTokens + probe.outputTokens,
            })}
          </Alert>
        </div>
      ) : null}

      {probe && !probe.ok ? (
        <div className="mt-4 space-y-2" data-testid="ai-probe-result">
          <Alert tone="error">
            {probe.reason === 'notConfigured'
              ? t('aiProbeNotConfigured')
              : probe.reason === 'budgetSpent'
                ? t('aiProbeBudget', { budget: probe.detail })
                : t('aiProbeFailed')}
          </Alert>
          {probe.reason === 'failed' && probe.detail ? (
            // Verbatim and untranslated: whoever reads this is diagnosing a
            // deployment, and a tidied-up message would waste their afternoon.
            <pre className="surface-card overflow-x-auto rounded-lg p-3 text-xs whitespace-pre-wrap">
              {probe.detail}
            </pre>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  AI_PROVIDERS,
  DEFAULT_AI_MODELS,
  type AiCredentialState,
  type AiProviderName,
  type SystemSettings,
} from '@casestudyhub/shared';
import { useRouter } from '@/i18n/navigation';
import { Card, CardTitle } from '@/components/ui/card';
import { Alert, Button, Field, Input, Select } from '@/components/ui/form';

/**
 * Which vendor the platform calls, and with what.
 *
 * One vendor per deployment, not one per class: two classes marked with two
 * different models would not be marked by the same standard.
 *
 * The key box is deliberately never filled in from the server. A page that
 * could show a key is a page that could leak one, so it shows the last four
 * characters instead - enough for whoever stored the key to know which it is -
 * and an empty box means "leave the stored key alone".
 */
export function AiProviderForm({
  settings,
  credentials,
}: {
  settings: SystemSettings;
  credentials: Record<AiProviderName, AiCredentialState>;
}) {
  const t = useTranslations('systemAdmin');
  const tError = useTranslations();
  const router = useRouter();

  const [provider, setProvider] = useState<AiProviderName>(settings.aiProvider);
  const [geminiTransport, setGeminiTransport] = useState(settings.aiGeminiTransport);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const stored = credentials[provider];
  /** Vertex is the one route that needs no key at all. */
  const needsKey = provider === 'openai' || geminiTransport === 'apiKey';

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const apiKey = String(form.get('apiKey') ?? '').trim();

    setBusy(true);
    setErrorKey(null);
    setNotice(null);

    try {
      // The key goes first. If the settings saved and the key did not, the
      // platform would be pointed at a vendor it cannot reach.
      if (apiKey) {
        const keyResponse = await fetch('/api/admin/ai', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ provider, apiKey }),
        });
        if (!keyResponse.ok) {
          const payload = (await keyResponse.json().catch(() => null)) as {
            error?: { messageKey?: string };
          } | null;
          setErrorKey(payload?.error?.messageKey ?? 'errors.unexpected');
          return;
        }
      }

      const response = await fetch('/api/admin/system', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          settings: {
            // Spread first: this form does not offer every setting, and a
            // partial object would turn off whatever it leaves out.
            ...settings,
            aiProvider: provider,
            aiGeminiTransport: geminiTransport,
            aiModels: {
              ...settings.aiModels,
              [provider]: String(form.get('model') ?? '').trim() || DEFAULT_AI_MODELS[provider],
            },
            aiLocation: String(form.get('aiLocation') ?? '').trim() || settings.aiLocation,
          },
          reason: String(form.get('reason') ?? ''),
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { messageKey?: string; details?: { fields?: { messageKey: string }[] } };
        } | null;
        setErrorKey(
          payload?.error?.details?.fields?.[0]?.messageKey ??
            payload?.error?.messageKey ??
            'errors.unexpected',
        );
        return;
      }

      setNotice(t('aiProviderSaved'));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function clearKey() {
    setBusy(true);
    setErrorKey(null);
    setNotice(null);
    try {
      await fetch('/api/admin/ai', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, apiKey: null }),
      });
      setNotice(t('aiKeyCleared'));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} data-testid="ai-provider">
      <Card>
        <CardTitle>{t('aiProviderTitle')}</CardTitle>
        <p className="text-muted mt-2 text-sm">{t('aiProviderBody')}</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label={t('aiProviderLabel')} htmlFor="aiProvider" hint={t('aiProviderHint')}>
            <Select
              id="aiProvider"
              name="aiProvider"
              value={provider}
              onChange={(event) => setProvider(event.target.value as AiProviderName)}
            >
              {AI_PROVIDERS.map((name) => (
                <option key={name} value={name}>
                  {t(`aiProviderName.${name}`)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('aiModelLabel')} htmlFor="model" hint={t('aiModelHint')}>
            <Input
              id="model"
              name="model"
              // Keyed on the vendor so switching vendor re-reads the box from
              // that vendor's own model name rather than keeping the other's.
              key={provider}
              defaultValue={settings.aiModels[provider] || DEFAULT_AI_MODELS[provider]}
              maxLength={80}
              required
            />
          </Field>

          {provider === 'gemini' ? (
            <Field
              label={t('aiTransportLabel')}
              htmlFor="aiGeminiTransport"
              hint={t('aiTransportHint')}
            >
              <Select
                id="aiGeminiTransport"
                name="aiGeminiTransport"
                value={geminiTransport}
                onChange={(event) => setGeminiTransport(event.target.value as 'vertex' | 'apiKey')}
              >
                <option value="vertex">{t('aiVertex')}</option>
                <option value="apiKey">{t('aiApiKey')}</option>
              </Select>
            </Field>
          ) : null}

          {provider === 'gemini' && geminiTransport === 'vertex' ? (
            <Field label={t('aiLocation')} htmlFor="aiLocation" hint={t('aiLocationHint')}>
              <Input
                id="aiLocation"
                name="aiLocation"
                defaultValue={settings.aiLocation}
                maxLength={40}
              />
            </Field>
          ) : null}

          {needsKey ? (
            <Field
              label={t('aiApiKeyLabel')}
              htmlFor="apiKey"
              hint={stored.set ? t('aiKeyStored', { hint: stored.hint }) : t('aiKeyMissing')}
            >
              <Input
                id="apiKey"
                name="apiKey"
                type="password"
                autoComplete="off"
                placeholder={stored.set ? t('aiKeyKeep') : ''}
              />
            </Field>
          ) : null}

          {/* Its own label rather than "Reason": the page already has one, and
              two fields with the same name are two fields nobody can point at. */}
          <Field label={t('aiReasonLabel')} htmlFor="aiReason" hint={t('reasonHint')}>
            <Input id="aiReason" name="reason" required minLength={3} maxLength={500} />
          </Field>
        </div>

        {errorKey ? (
          <div className="mt-4">
            <Alert tone="error">{tError(errorKey)}</Alert>
          </div>
        ) : null}
        {notice ? (
          <div className="mt-4">
            <Alert tone="success">{notice}</Alert>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {t('aiProviderSave')}
          </Button>
          {needsKey && stored.set ? (
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void clearKey()}>
              {t('aiKeyClear')}
            </Button>
          ) : null}
        </div>
      </Card>
    </form>
  );
}

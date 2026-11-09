'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/form';
import { authErrorKey, signInWithLmsTokenAndStartSession } from '@/lib/firebase/auth-client';

function ticketFromHash(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('ticket');
  return value && value.length > 20 ? value : null;
}

export function LtiLaunch({ locale }: { locale: string }) {
  const t = useTranslations('lti');
  const tAll = useTranslations();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  // React runs effects twice in development; a ticket can only be used once.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const ticket = ticketFromHash(window.location.hash);
    // Off the address bar at once, so it is not bookmarked or shared.
    window.history.replaceState(null, '', window.location.pathname);

    void (async () => {
      if (!ticket) {
        setErrorKey('errors.ltiTicketInvalid');
        return;
      }
      try {
        const response = await fetch('/api/lti/launch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticket }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          setErrorKey(body?.error?.messageKey ?? 'errors.unexpected');
          return;
        }
        await signInWithLmsTokenAndStartSession(body.customToken as string);
        // A full navigation, so the server renders the next page with the new cookie.
        window.location.replace(`/${locale}${body.next as string}`);
      } catch (error) {
        setErrorKey(
          error instanceof Error && error.message.startsWith('errors.')
            ? error.message
            : authErrorKey(error),
        );
      }
    })();
  }, [locale]);

  if (errorKey) {
    return (
      <div className="space-y-4">
        <Alert tone="error">{tAll(errorKey)}</Alert>
        <p className="text-muted text-sm">{t('launchFailedHint')}</p>
      </div>
    );
  }
  return (
    <p className="text-muted text-sm" role="status">
      {t('launching')}
    </p>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { endSession } from '@/lib/firebase/auth-client';

export function SignOutButton() {
  const t = useTranslations('nav');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await endSession();
      router.replace('/login');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="surface-card hover:border-brand-400 inline-flex h-9 items-center rounded-full px-3 text-sm font-medium transition-colors disabled:opacity-60"
    >
      {t('signOut')}
    </button>
  );
}

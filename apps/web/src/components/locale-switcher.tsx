'use client';

import { useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { LOCALES, type Locale } from '@casestudyhub/shared';

const LABELS: Record<Locale, string> = { vi: 'Tiếng Việt', en: 'English' };

export function LocaleSwitcher() {
  const t = useTranslations('common');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  return (
    <div
      className="surface-card inline-flex items-center gap-1 rounded-full p-1"
      role="group"
      aria-label={t('language')}
    >
      {LOCALES.map((value) => {
        const active = value === locale;
        return (
          <button
            key={value}
            type="button"
            disabled={isPending || active}
            aria-current={active ? 'true' : undefined}
            onClick={() => startTransition(() => router.replace(pathname, { locale: value }))}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              active
                ? 'bg-brand-600 text-white'
                : 'text-muted hover:bg-brand-50 dark:hover:bg-brand-900'
            }`}
          >
            <span className="sr-only">{LABELS[value]}</span>
            <span aria-hidden="true">{value.toUpperCase()}</span>
          </button>
        );
      })}
    </div>
  );
}

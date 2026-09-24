'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';

export interface NavItem {
  href: string;
  labelKey: string;
}

/**
 * One nav definition drives both the desktop sidebar and the mobile bar, so
 * the two can never drift apart. Which items arrive here is decided on the
 * server from the caller's role.
 */
export function AppNav({ items, variant }: { items: NavItem[]; variant: 'sidebar' | 'mobile' }) {
  const t = useTranslations('nav');
  const pathname = usePathname();

  const base =
    variant === 'sidebar'
      ? 'flex flex-col gap-1'
      : 'grid grid-flow-col justify-stretch border-t border-[var(--border-subtle)] bg-[var(--surface)]';

  return (
    <nav className={base} aria-label={t('dashboard')}>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const classes =
          variant === 'sidebar'
            ? `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active ? 'bg-brand-600 text-white' : 'text-muted hover:bg-[var(--surface-muted)]'
              }`
            : `py-3 text-center text-xs font-medium ${active ? 'text-brand-600 dark:text-brand-300' : 'text-muted'}`;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={classes}
          >
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}

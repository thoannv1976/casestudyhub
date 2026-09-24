'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/**
 * The bell in the header, on every page.
 *
 * It asks for the count after the page has rendered rather than during it:
 * the list is the most expensive thing a person can read - it walks their
 * assignments to work out what is nearly due - and nobody should wait for it
 * to see the page they actually asked for.
 */
export function NotificationBell() {
  const t = useTranslations('notifications');
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch('/api/notifications');
        if (!response.ok) return;
        const body = (await response.json()) as { unread?: number };
        if (!cancelled) setUnread(body.unread ?? 0);
      } catch {
        // A bell that cannot be counted is a bell without a number, not an
        // error worth putting in front of somebody.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Link
      href="/notifications"
      data-testid="notification-bell"
      aria-label={unread > 0 ? t('unreadLabel', { count: unread }) : t('title')}
      className="text-muted hover:bg-[var(--surface-muted)] relative inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
    >
      <span aria-hidden="true" className="text-lg leading-none">
        🔔
      </span>
      {unread > 0 ? (
        <span
          aria-hidden="true"
          data-testid="notification-count"
          className="bg-accent-500 absolute -top-0.5 -right-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-semibold text-white"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}
    </Link>
  );
}

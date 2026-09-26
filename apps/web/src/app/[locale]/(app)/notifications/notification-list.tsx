'use client';

import { useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { notificationKeyOf, unreadCount, type AppNotification } from '@casestudyhub/shared';
import { Badge, Card } from '@/components/ui/card';
import { Button } from '@/components/ui/form';
import { Link } from '@/i18n/navigation';

/**
 * The list, rendered in the reader's language from a key and its parameters.
 *
 * Nothing stored here is a sentence, so a student who switches to English
 * sees English for the marks they were told about in Vietnamese last week.
 */
/**
 * Parameters that name a moment are stored as ISO strings, because that is
 * what survives a database. ICU needs a Date to format one in the reader's
 * language, so they are turned back here rather than at every call site.
 */
const DATE_PARAMS = new Set(['deadline', 'presentation']);

function valuesFor(notification: AppNotification): Record<string, string | number | Date> {
  return Object.fromEntries(
    Object.entries(notification.params).map(([key, value]) =>
      DATE_PARAMS.has(key) && typeof value === 'string' ? [key, new Date(value)] : [key, value],
    ),
  );
}

export function NotificationList({ initial }: { initial: AppNotification[] }) {
  const t = useTranslations('notifications');
  const format = useFormatter();
  const [notifications, setNotifications] = useState(initial);
  const [marking, setMarking] = useState(false);

  const unread = useMemo(() => unreadCount(notifications), [notifications]);

  async function markAllRead() {
    setMarking(true);
    try {
      const response = await fetch('/api/notifications', { method: 'POST' });
      if (response.ok) {
        const readAt = new Date().toISOString();
        // The derived deadline warnings have no stored row to mark, so they
        // stay: they go when the work goes in, which is the only thing that
        // should make them go.
        setNotifications((current) =>
          current.map((notification) =>
            notification.kind === 'submission.dueSoon' || notification.readAt
              ? notification
              : { ...notification, readAt },
          ),
        );
      }
    } finally {
      setMarking(false);
    }
  }

  if (notifications.length === 0) {
    return (
      <Card>
        <p className="text-muted text-sm">{t('empty')}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted text-sm">{t('unreadLabel', { count: unread })}</p>
        <Button
          variant="ghost"
          disabled={marking || unread === 0}
          onClick={() => void markAllRead()}
        >
          {t('markAllRead')}
        </Button>
      </div>

      <ul className="space-y-3" data-testid="notification-list">
        {notifications.map((notification) => (
          <li key={notification.id}>
            <Link href={notification.href} className="block">
              <Card className={notification.readAt ? 'opacity-70' : ''}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="text-sm font-medium">
                    {t(`kind.${notificationKeyOf(notification.kind)}`, valuesFor(notification))}
                  </p>
                  {notification.readAt ? null : <Badge tone="accent">{t('new')}</Badge>}
                </div>
                <p className="text-muted mt-2 text-xs">
                  {format.dateTime(new Date(notification.createdAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </p>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

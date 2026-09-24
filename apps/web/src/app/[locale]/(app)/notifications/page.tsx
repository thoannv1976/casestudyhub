import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { listNotifications } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { NotificationList } from './notification-list';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notifications');
  return { title: t('title') };
}

/**
 * Everything the app has told this person, and the one thing they missed.
 *
 * The stored entries were written by whatever action caused them; the deadline
 * warnings are worked out here, from what the group still owes. Both arrive
 * as a key and its parameters, and are turned into a sentence by the list.
 */
export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireSessionUser();
  const t = await getTranslations('notifications');
  const notifications = await listNotifications(user.uid);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted mt-2 text-sm">{t('subtitle')}</p>
      </div>

      <NotificationList initial={notifications} />
    </div>
  );
}

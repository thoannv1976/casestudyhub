import { NextResponse } from 'next/server';
import { unreadCount, type AppNotification } from '@casestudyhub/shared';
import { listNotifications, markAllRead } from '@casestudyhub/core';
import { requireSessionUser } from '@casestudyhub/core/auth/session';
import { respondWithError } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * The notification list, and the one action there is to take on it.
 *
 * Every page in the app asks for this once, to put a number on the bell, so
 * the answer is cached briefly per person. Thirty seconds is short enough
 * that a student reaching their results page still sees the mark announced,
 * and long enough that walking around the app does not re-read every
 * assignment they have.
 */
const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; notifications: AppNotification[] }>();

async function forCaller(uid: string): Promise<AppNotification[]> {
  const cached = cache.get(uid);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.notifications;

  const notifications = await listNotifications(uid);
  cache.set(uid, { at: Date.now(), notifications });

  if (cache.size > 200) {
    for (const [key, value] of cache) {
      if (Date.now() - value.at > CACHE_MS) cache.delete(key);
    }
  }

  return notifications;
}

/** Test seam, and what the mark-read action calls so the bell drops at once. */
export function clearNotificationCache(uid?: string): void {
  if (uid) cache.delete(uid);
  else cache.clear();
}

export async function GET() {
  try {
    const caller = await requireSessionUser();
    const notifications = await forCaller(caller.uid);
    return NextResponse.json({ notifications, unread: unreadCount(notifications) });
  } catch (error) {
    return respondWithError(error);
  }
}

/** Marks everything stored as read. There is nothing else to do to one. */
export async function POST() {
  try {
    const caller = await requireSessionUser();
    const marked = await markAllRead(caller.uid);
    clearNotificationCache(caller.uid);
    return NextResponse.json({ marked });
  } catch (error) {
    return respondWithError(error);
  }
}

import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getSessionUser } from '@casestudyhub/core/auth/session';
import { AppNav, type NavItem } from '@/components/app-nav';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { NotificationBell } from '@/components/notification-bell';
import { SignOutButton } from '@/components/sign-out-button';
import { ThemeToggle } from '@/components/theme-toggle';
import { Link } from '@/i18n/navigation';

export const dynamic = 'force-dynamic';

/**
 * Everything under this layout requires a signed-in caller. The check runs on
 * the server before any child renders, so a protected page never reaches the
 * browser for an anonymous visitor - the route handlers behind it check again.
 */
export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getSessionUser();
  if (!user) redirect(`/${locale}/login`);

  // An account still on the temporary password an admin handed over reaches
  // nothing else until it is replaced.
  if (user.mustChangePassword) redirect(`/${locale}/change-password`);

  const tApp = await getTranslations('app');

  const items: NavItem[] = [{ href: '/dashboard', labelKey: 'dashboard' }];
  if (user.role === 'student') {
    items.push({ href: '/classes', labelKey: 'myClasses' });
    items.push({ href: '/portfolio', labelKey: 'portfolio' });
  }
  if (user.role === 'lecturer' || user.role === 'admin') {
    items.push({ href: '/teaching', labelKey: 'teaching' });
  }
  items.push({ href: '/cases', labelKey: 'caseLibrary' });
  items.push({ href: '/profile', labelKey: 'profile' });
  if (user.role === 'admin') {
    items.push({ href: '/admin', labelKey: 'admin' });
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-[var(--border-subtle)] bg-[var(--surface)]/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="bg-brand-600 flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white"
            >
              CH
            </span>
            {/* The wordmark stands down on a phone: four controls and a name
                do not fit in 390px, and the mark alone still says where you
                are. */}
            <span className="hidden font-semibold sm:inline">{tApp('name')}</span>
          </Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <NotificationBell />
            <LocaleSwitcher />
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-8 px-4 py-8 sm:px-6">
        <aside className="hidden w-52 shrink-0 md:block">
          <AppNav items={items} variant="sidebar" />
        </aside>
        <main id="main-content" className="min-w-0 flex-1 pb-20 md:pb-0">
          {children}
        </main>
      </div>

      <div className="sticky bottom-0 md:hidden">
        <AppNav items={items} variant="mobile" />
      </div>
    </div>
  );
}

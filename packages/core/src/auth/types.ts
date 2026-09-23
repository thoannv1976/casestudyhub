import type { Locale, UserRole } from '@casestudyhub/shared';

/** The caller of a request, as decoded from the session cookie. */
export interface SessionUser {
  uid: string;
  email: string;
  role: UserRole;
  preferredLanguage?: Locale;
  /**
   * Set on an account an admin created with a temporary password. Until it is
   * cleared the app lets the user reach nothing but the change-password page.
   */
  mustChangePassword?: boolean;
}

export const SESSION_COOKIE_NAME = '__session';

/** Five days, the maximum Firebase allows for a session cookie. */
export const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

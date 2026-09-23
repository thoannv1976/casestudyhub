import type { Locale, UserRole } from '@casestudyhub/shared';

/** The caller of a request, as decoded from the session cookie. */
export interface SessionUser {
  uid: string;
  email: string;
  role: UserRole;
  preferredLanguage?: Locale;
}

export const SESSION_COOKIE_NAME = '__session';

/** Five days, the maximum Firebase allows for a session cookie. */
export const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

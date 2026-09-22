import { defineRouting } from 'next-intl/routing';
import { DEFAULT_LOCALE, LOCALES } from '@casestudyhub/shared';

/**
 * Interface language routing. The UI language is independent of the language
 * of the case study documents a student reads (SRS 15).
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
  localeCookie: {
    name: 'CASESTUDYHUB_LOCALE',
    maxAge: 60 * 60 * 24 * 365,
  },
});

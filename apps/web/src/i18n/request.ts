import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { COURSE_TIME_ZONE } from '@casestudyhub/shared';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    // Without this, next-intl formats dates in the runtime's zone - UTC on
    // Cloud Run - and hands that rendering to the browser to keep server and
    // client consistent. Every deadline in the app then reads seven hours
    // early, everywhere, permanently.
    timeZone: COURSE_TIME_ZONE,
  };
});

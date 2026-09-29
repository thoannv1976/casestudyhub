/**
 * One time zone for the whole platform.
 *
 * A deadline is a single moment the whole class shares, so everybody must read
 * the same number off the screen. Following each viewer's device instead would
 * mean a student abroad sees a different deadline from the student beside
 * them, and neither would match what the lecturer announced.
 *
 * Fixing it here also closes the bug this file was written for. Cloud Run runs
 * with `TZ=UTC`, and next-intl falls back to the runtime's zone when none is
 * configured - so a deadline set for 10:10 in Hanoi was shown to everybody as
 * 03:10, seven hours early, on every screen the server rendered. Worse, the
 * case-selection form read its value back through `toISOString()`, so saving
 * that form again without touching it moved the real deadline seven hours
 * earlier, and again on the next save.
 *
 * Everything stored stays a UTC instant. This is about reading and typing.
 */
export const COURSE_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/** The parts of an instant as they read on a wall clock in `timeZone`. */
function wallClockParts(
  date: Date,
  timeZone: string,
): { year: string; month: string; day: string; hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const find = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '00';

  return {
    year: find('year'),
    month: find('month'),
    day: find('day'),
    // Some runtimes render midnight as hour 24 rather than 00.
    hour: find('hour') === '24' ? '00' : find('hour'),
    minute: find('minute'),
  };
}

/**
 * An ISO instant, written the way a `datetime-local` input wants it: the wall
 * clock of the course's time zone, with no zone attached.
 *
 * Returns an empty string for anything unparseable, which is what an empty
 * input expects.
 */
export function toZonedInput(iso: string | null | undefined, timeZone = COURSE_TIME_ZONE): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const { year, month, day, hour, minute } = wallClockParts(date, timeZone);
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/**
 * The reverse: what a person typed into a `datetime-local` input, read as the
 * course's wall clock, turned back into the instant it names.
 *
 * The offset is measured rather than assumed. Vietnam has no daylight saving,
 * so a constant +7 would work today - but a constant is the kind of thing that
 * stays behind when a course moves, and measuring costs one extra format.
 */
export function fromZonedInput(wallClock: string, timeZone = COURSE_TIME_ZONE): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(wallClock)) return null;

  // Read the typed time as if it were UTC, then correct by however far that
  // guess lands from the wall clock it should have shown.
  const guess = new Date(`${wallClock.slice(0, 16)}:00Z`);
  if (Number.isNaN(guess.getTime())) return null;

  const { year, month, day, hour, minute } = wallClockParts(guess, timeZone);
  const asShown = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:00Z`);
  if (Number.isNaN(asShown)) return null;

  return new Date(guess.getTime() - (asShown - guess.getTime())).toISOString();
}

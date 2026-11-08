import { resolveSafeLocale } from "./safe-locale.ts";

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MS_PER_DAY = 86_400_000;

export type RelativeTimeOptions = {
  readonly style?: Intl.RelativeTimeFormatStyle;
  readonly absoluteAfterDays?: number;
  readonly withTime?: boolean;
  readonly timeZone?: string;
  /** Translated text for past moments below a minute ("just now") instead of "N seconds ago". */
  readonly justNow?: string;
};

function formatAbsolute(atMs: number, locale: string, options: RelativeTimeOptions): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(options.withTime === true && { hour: "2-digit", minute: "2-digit" }),
    timeZone: options.timeZone,
  }).format(atMs);
}

function formatClock(atMs: number, locale: string, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone }).format(atMs);
}

function calendarDayNumber(ms: number, timeZone: string | undefined): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone,
  }).formatToParts(ms);
  const part = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day")) / MS_PER_DAY;
}

/** "5 minutes ago" / "in 30 seconds" in the given locale. The unit grows with the
 *  distance (seconds below a minute, minutes below an hour, hours below a day);
 *  each step is chosen on the already rounded value so 59.6 minutes reads "1 hour"
 *  instead of "60 minutes". From a day on, the distance counts calendar days in
 *  `options.timeZone` (default: the runtime's zone), so "yesterday" means the day
 *  before today and not 24 hours ago. `numeric: "auto"` yields "now" and "yesterday". */
export function formatRelativeTime(
  atMs: number,
  nowMs: number,
  locale: string | undefined,
  options: RelativeTimeOptions = {},
): string {
  const safeLocale = resolveSafeLocale(locale);
  const formatter = new Intl.RelativeTimeFormat(safeLocale, {
    numeric: "auto",
    style: options.style ?? "long",
  });
  const seconds = Math.round((atMs - nowMs) / 1000);
  if (Math.abs(seconds) < SECONDS_PER_MINUTE) {
    if (options.justNow !== undefined && seconds <= 0) return options.justNow;
    return formatter.format(seconds, "second");
  }
  const minutes = Math.round(seconds / SECONDS_PER_MINUTE);
  if (Math.abs(minutes) < MINUTES_PER_HOUR) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / MINUTES_PER_HOUR);
  if (Math.abs(hours) < HOURS_PER_DAY) return formatter.format(hours, "hour");
  const days =
    calendarDayNumber(atMs, options.timeZone) - calendarDayNumber(nowMs, options.timeZone);
  // 23.5+ hours inside one calendar day still reads as hours, never as "today".
  if (days === 0) return formatter.format(hours, "hour");
  if (options.absoluteAfterDays !== undefined && Math.abs(days) >= options.absoluteAfterDays) {
    return formatAbsolute(atMs, safeLocale, options);
  }
  const relative = formatter.format(days, "day");
  return days === -1 && options.withTime === true
    ? `${relative}, ${formatClock(atMs, safeLocale, options.timeZone)}`
    : relative;
}

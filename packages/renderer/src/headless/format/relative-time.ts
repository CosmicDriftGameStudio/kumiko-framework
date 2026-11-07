const FALLBACK_LOCALE = "en-US";

// An invalid tag makes every Intl constructor and toLocaleString throw a
// RangeError; without an ErrorBoundary that would take down the page on
// focus/blur. Canonicalizing once up front keeps all call sites safe.
export function resolveSafeLocale(locale: string | undefined): string {
  const candidate =
    locale ?? (typeof navigator !== "undefined" ? navigator.language : undefined) ?? "";
  try {
    return Intl.getCanonicalLocales(candidate)[0] ?? FALLBACK_LOCALE;
  } catch {
    return FALLBACK_LOCALE;
  }
}

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/** "5 minutes ago" / "in 30 seconds" in the given locale. The unit grows with the
 *  distance (seconds below a minute, minutes below an hour, hours below a day,
 *  days beyond); each step is chosen on the already rounded value so 59.6 minutes
 *  reads "1 hour" instead of "60 minutes". `numeric: "auto"` yields "now" and "yesterday". */
export function formatRelativeTime(atMs: number, nowMs: number, locale: string): string {
  const formatter = new Intl.RelativeTimeFormat(resolveSafeLocale(locale), { numeric: "auto" });
  const seconds = Math.round((atMs - nowMs) / 1000);
  if (Math.abs(seconds) < SECONDS_PER_MINUTE) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / SECONDS_PER_MINUTE);
  if (Math.abs(minutes) < MINUTES_PER_HOUR) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / MINUTES_PER_HOUR);
  if (Math.abs(hours) < HOURS_PER_DAY) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / HOURS_PER_DAY), "day");
}

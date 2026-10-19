import { useEffect, useRef, useState } from "react";
import { resolveSafeLocale } from "../primitives/locale-number.ts";

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

const SECOND_TICK_MS = 1000;
// Above a minute the text changes at most once per minute; half a minute keeps it
// at most 30 s late without waking the page every second for a "5 minutes ago".
const COARSE_TICK_MS = 30_000;
const SECOND_RESOLUTION_BELOW_MS = SECONDS_PER_MINUTE * 1000;

/** Interval at which a relative text at `distanceMs` from now needs a redraw. */
export function relativeTickIntervalMs(distanceMs: number): number {
  return distanceMs < SECOND_RESOLUTION_BELOW_MS ? SECOND_TICK_MS : COARSE_TICK_MS;
}

/** Returns a formatter for relative times that redraws its component on a timer, but
 *  only while a render actually called it: no relative output on screen, no timer. */
export function useRelativeTimeFormatter(locale: string): (atMs: number) => string {
  const [, setTick] = useState(0);
  const [intervalMs, setIntervalMs] = useState<number | null>(null);
  const nearestDistanceMs = useRef(Number.POSITIVE_INFINITY);
  nearestDistanceMs.current = Number.POSITIVE_INFINITY;

  // After every render: the formatter calls of this render decide whether and how fast to tick.
  useEffect(() => {
    const distance = nearestDistanceMs.current;
    setIntervalMs(distance === Number.POSITIVE_INFINITY ? null : relativeTickIntervalMs(distance));
  });

  useEffect(() => {
    // skip: no relative output rendered, nothing to keep current
    if (intervalMs === null) return;
    const timer = setInterval(() => setTick((tick) => tick + 1), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return (atMs) => {
    const nowMs = Date.now();
    nearestDistanceMs.current = Math.min(nearestDistanceMs.current, Math.abs(atMs - nowMs));
    return formatRelativeTime(atMs, nowMs, locale);
  };
}

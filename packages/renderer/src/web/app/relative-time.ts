import { useEffect, useRef, useState } from "react";
import { formatRelativeTime } from "../../headless/format/relative-time.ts";
import { useTranslation } from "../../i18n.tsx";
import { serverNowMs } from "../../server-clock.ts";

const SECONDS_PER_MINUTE = 60;

// One look for relative times everywhere: short units, yesterday with clock, absolute after a week.
const LIST_RELATIVE_OPTIONS = {
  style: "short",
  withTime: true,
  absoluteAfterDays: 7,
} as const;

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
  const t = useTranslation();
  const justNow = t("kumiko.time.justNow");
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
    const nowMs = serverNowMs();
    nearestDistanceMs.current = Math.min(nearestDistanceMs.current, Math.abs(atMs - nowMs));
    return formatRelativeTime(atMs, nowMs, locale, { ...LIST_RELATIVE_OPTIONS, justNow });
  };
}

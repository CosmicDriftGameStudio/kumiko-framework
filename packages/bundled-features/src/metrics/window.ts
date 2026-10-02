import type { AggregateTimeBucket } from "@cosmicdrift/kumiko-types/aggregate-types";
import { Temporal } from "temporal-polyfill";
import type { MetricRange } from "./constants.js";
import type { MetricDefinition } from "./types.js";

export type MetricWindow = {
  readonly start: Temporal.Instant;
  readonly end: Temporal.Instant;
  readonly previousStart: Temporal.Instant;
};

const RANGE_HOURS: Readonly<Record<MetricRange, number>> = {
  "24h": 24,
  "7d": 7 * 24,
  "14d": 14 * 24,
  "30d": 30 * 24,
};

// The 24h range counts as one day when bucketing by day.
const RANGE_DAYS: Readonly<Record<MetricRange, number>> = {
  "24h": 1,
  "7d": 7,
  "14d": 14,
  "30d": 30,
};

// Offset strings ("+01:00") pass Intl/Temporal as ISO offsets but Postgres
// date_trunc reads them as POSIX zones with the opposite sign, so only named
// zones are accepted.
export function isValidTimeZone(timeZone: string): boolean {
  if (/^[+-]/.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function resolveBucket(
  metric: MetricDefinition,
  range: MetricRange,
): AggregateTimeBucket | undefined {
  if (metric.bucket === undefined) return undefined;
  if (metric.bucket === "auto") return range === "24h" ? "hour" : "day";
  return metric.bucket;
}

export function computeWindow(
  range: MetricRange,
  bucket: AggregateTimeBucket | undefined,
  timeZone: string,
  now: Temporal.Instant,
): MetricWindow {
  const zonedNow = now.toZonedDateTimeISO(timeZone);
  let start: Temporal.Instant;
  if (bucket === "hour") {
    const hourStart = zonedNow.round({ smallestUnit: "hour", roundingMode: "floor" });
    start = hourStart.subtract({ hours: RANGE_HOURS[range] - 1 }).toInstant();
  } else if (bucket === "day") {
    start = zonedNow
      .startOfDay()
      .subtract({ days: RANGE_DAYS[range] - 1 })
      .startOfDay()
      .toInstant();
  } else {
    start = now.subtract({ hours: RANGE_HOURS[range] });
  }
  const spanMs = now.epochMilliseconds - start.epochMilliseconds;
  const previousStart = Temporal.Instant.fromEpochMilliseconds(start.epochMilliseconds - spanMs);
  return { start, end: now, previousStart };
}

// Every bucket start in [window.start, window.end], in the display zone —
// SQL only returns buckets that have rows, the chart needs the gaps too.
export function bucketStartsMs(
  window: MetricWindow,
  bucket: AggregateTimeBucket,
  timeZone: string,
): readonly number[] {
  const starts: number[] = [];
  const step = bucket === "hour" ? { hours: 1 } : { days: 1 };
  let cursor = window.start.toZonedDateTimeISO(timeZone);
  while (cursor.epochMilliseconds <= window.end.epochMilliseconds) {
    starts.push(cursor.epochMilliseconds);
    cursor = bucket === "day" ? cursor.add(step).startOfDay() : cursor.add(step);
  }
  return starts;
}

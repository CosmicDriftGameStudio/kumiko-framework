import type { WhereObject } from "@cosmicdrift/kumiko-framework/bun-db";
import type {
  AggregateDimension,
  AggregateKey,
  AggregateRow,
} from "@cosmicdrift/kumiko-types/aggregate-types";
import type { TenantDb } from "@cosmicdrift/kumiko-types/tenant-db-types";
import type { Temporal } from "temporal-polyfill";
import { MAX_GROUP_ROWS, type MetricRange } from "./constants.js";
import type {
  MetricDefinition,
  MetricDeltaDirection,
  MetricPoint,
  MetricResult,
  MetricRow,
  MetricSegment,
  MetricSeries,
} from "./types.js";
import { bucketStartsMs, computeWindow, resolveBucket } from "./window.js";

export type MetricRunParams = {
  readonly range: MetricRange;
  readonly timeZone: string;
  readonly now: Temporal.Instant;
  /** Extra filter that narrows the source to the caller's scope. */
  readonly scopeWhere: WhereObject;
};

const NULL_KEY_TEXT = "—";

function keyText(key: AggregateKey | undefined): string {
  return key === null || key === undefined ? NULL_KEY_TEXT : String(key);
}

function formatDelta(
  value: number | null,
  previousValue: number | null,
): { delta: string | null; deltaDirection: MetricDeltaDirection | null } {
  if (value === null || previousValue === null || previousValue === 0 || value === previousValue) {
    return { delta: null, deltaDirection: null };
  }
  const percent = Math.round((Math.abs(value - previousValue) / Math.abs(previousValue)) * 100);
  if (percent === 0) return { delta: null, deltaDirection: null };
  return { delta: `${percent} %`, deltaDirection: value > previousValue ? "up" : "down" };
}

function fractionOf(value: number, total: number | null): number {
  if (total === null || total <= 0) return 0;
  return Math.min(1, Math.max(0, value / total));
}

export async function runMetric(
  db: TenantDb,
  metric: MetricDefinition,
  params: MetricRunParams,
): Promise<MetricResult> {
  const range = metric.window ?? params.range;
  const bucket = resolveBucket(metric, range);
  const { timeField } = metric;
  const window =
    timeField === undefined ? undefined : computeWindow(range, bucket, params.timeZone, params.now);

  const baseWhere: WhereObject = { ...metric.where, ...params.scopeWhere };
  const currentWhere: WhereObject =
    timeField === undefined || window === undefined
      ? baseWhere
      : { ...baseWhere, [timeField]: { gte: window.start, lte: window.end } };
  const previousWhere: WhereObject | undefined =
    timeField === undefined || window === undefined || metric.comparePrevious === false
      ? undefined
      : { ...baseWhere, [timeField]: { gte: window.previousStart, lt: window.start } };

  const aggregate = (
    groupBy: readonly AggregateDimension[],
    where: WhereObject,
    extra: { readonly orderByValue?: "desc"; readonly limit?: number } = {},
  ): Promise<readonly AggregateRow[]> =>
    db.aggregate(metric.source, { measure: metric.measure, groupBy, ...extra }, where);

  const bucketDimension: AggregateDimension | undefined =
    timeField !== undefined && bucket !== undefined
      ? { field: timeField, bucket, timeZone: params.timeZone }
      : undefined;
  const { groupBy, stackBy } = metric;

  const [totalRows, previousRows, pointRows, groupRows, stackRows, seriesRows] = await Promise.all([
    aggregate([], currentWhere),
    previousWhere === undefined ? Promise.resolve(undefined) : aggregate([], previousWhere),
    bucketDimension !== undefined && groupBy === undefined
      ? aggregate([bucketDimension], currentWhere)
      : Promise.resolve([]),
    groupBy === undefined
      ? Promise.resolve([])
      : aggregate([{ field: groupBy }], currentWhere, {
          orderByValue: "desc",
          limit: MAX_GROUP_ROWS,
        }),
    groupBy !== undefined && stackBy !== undefined
      ? aggregate([{ field: groupBy }, { field: stackBy }], currentWhere)
      : Promise.resolve([]),
    bucketDimension !== undefined && groupBy !== undefined
      ? aggregate([{ field: groupBy }, bucketDimension], currentWhere)
      : Promise.resolve([]),
  ]);

  const value = totalRows[0]?.value ?? null;
  const previousValue = previousRows?.[0]?.value ?? null;
  const labelOf = (key: string): string => metric.groupLabels?.[key] ?? key;
  const gapValue = metric.measure.fn === "avg" ? null : 0;

  const bucketStarts =
    window !== undefined && bucket !== undefined
      ? bucketStartsMs(window, bucket, params.timeZone)
      : [];
  const fillBuckets = (byBucketMs: ReadonlyMap<number, number | null>): readonly MetricPoint[] =>
    bucketStarts.map((atMs) => ({ atMs, value: byBucketMs.get(atMs) ?? gapValue }));

  const points = fillBuckets(
    new Map(pointRows.map((row): [number, number | null] => [Number(row.keys[0]), row.value])),
  );

  const segmentsByGroup = new Map<string, MetricSegment[]>();
  for (const row of stackRows) {
    const groupKey = keyText(row.keys[0]);
    const stackKey = keyText(row.keys[1]);
    const segments = segmentsByGroup.get(groupKey) ?? [];
    segments.push({ key: stackKey, label: labelOf(stackKey), value: row.value ?? 0 });
    segmentsByGroup.set(groupKey, segments);
  }

  const rows: readonly MetricRow[] = groupRows.map((row) => {
    const key = keyText(row.keys[0]);
    const rowValue = row.value ?? 0;
    const segments = segmentsByGroup.get(key);
    return {
      id: key,
      key,
      label: labelOf(key),
      value: rowValue,
      fraction: fractionOf(rowValue, value),
      ...(stackBy !== undefined && { segments: segments ?? [] }),
    };
  });

  const bucketsByGroup = new Map<string, Map<number, number | null>>();
  for (const row of seriesRows) {
    const groupKey = keyText(row.keys[0]);
    const buckets = bucketsByGroup.get(groupKey) ?? new Map<number, number | null>();
    buckets.set(Number(row.keys[1]), row.value);
    bucketsByGroup.set(groupKey, buckets);
  }
  const series: readonly MetricSeries[] = rows.map((row) => ({
    key: row.key,
    label: row.label,
    points: fillBuckets(bucketsByGroup.get(row.key) ?? new Map()),
  }));

  return {
    value,
    previousValue,
    ...formatDelta(value, previousValue),
    windowStartMs: window?.start.epochMilliseconds ?? null,
    windowEndMs: window?.end.epochMilliseconds ?? null,
    points,
    series,
    rows,
    nextCursor: null,
  };
}

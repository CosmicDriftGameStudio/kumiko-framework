import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { Temporal } from "temporal-polyfill";
import { METRICS_FEATURE, metricQueryName } from "../constants.js";
import { createMetricsFeature } from "../feature.js";
import type { MetricResult } from "../types.js";
import {
  ALL_TEST_METRICS,
  amountMetric,
  averageMetric,
  byStatusMetric,
  byStatusOverTimeMetric,
  countMetric,
  eventsTable,
  fixedClock,
  globalTable,
  manyUsersMetric,
  seedMetricRows,
  snapshotMetric,
  stackedMetric,
  TENANT_A,
  TENANT_C,
  TENANT_D,
  usersMetric,
  usersWithoutComparisonMetric,
} from "./metrics-fixtures.js";

const epochMs = (iso: string): number => Temporal.Instant.from(iso).epochMilliseconds;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

let stack: TestStack;

const admin = (tenantId: string) =>
  createTestUser({ id: Number(tenantId.slice(-4)) + 1, tenantId, roles: ["TenantAdmin"] });

async function run(
  metric: { readonly id: string },
  tenantId: string,
  payload: Record<string, unknown> = {},
): Promise<MetricResult> {
  return stack.http.queryOk<MetricResult>(
    metricQueryName("tenant", metric.id),
    payload,
    admin(tenantId),
  );
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createMetricsFeature({ metrics: ALL_TEST_METRICS, now: fixedClock })],
  });
  await unsafePushTables(stack.db, { eventsTable, globalTable });
  await seedMetricRows(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("metrics aggregates", () => {
  test("query names are feature:query:id", () => {
    expect(metricQueryName("tenant", countMetric.id)).toBe(`${METRICS_FEATURE}:query:events-count`);
  });

  test("24h range: hourly points with zero gaps, delta against the previous 24h", async () => {
    const result = await run(countMetric, TENANT_A, { range: "24h" });
    const windowStart = epochMs("2026-03-09T13:00:00Z");
    expect(result.value).toBe(4);
    expect(result.previousValue).toBe(1);
    expect(result.delta).toBe("300 %");
    expect(result.deltaDirection).toBe("up");
    expect(result.windowStartMs).toBe(windowStart);
    expect(result.points).toHaveLength(24);
    const valueAt = (iso: string): number | null =>
      result.points.find((point) => point.atMs === epochMs(iso))?.value ?? null;
    expect(valueAt("2026-03-09T13:00:00Z")).toBe(0);
    expect(valueAt("2026-03-09T20:00:00Z")).toBe(1);
    expect(valueAt("2026-03-10T10:00:00Z")).toBe(2);
    expect(valueAt("2026-03-10T11:00:00Z")).toBe(1);
    expect(valueAt("2026-03-10T12:00:00Z")).toBe(0);
    expect(result.points.map((point) => point.atMs)).toEqual(
      Array.from({ length: 24 }, (_, hour) => windowStart + hour * HOUR_MS),
    );
  });

  test("7d range switches to day buckets", async () => {
    const result = await run(countMetric, TENANT_A, { range: "7d" });
    expect(result.points).toHaveLength(7);
    expect(result.points[0]?.atMs).toBe(epochMs("2026-03-04T00:00:00Z"));
    expect(result.value).toBe(5);
    expect(result.previousValue).toBe(1);
  });

  test("groupBy yields ranked rows with fractions and i18n-key labels", async () => {
    const result = await run(byStatusMetric, TENANT_A, { range: "7d" });
    expect(result.rows.map((row) => [row.key, row.value, row.label])).toEqual([
      ["ok", 3, "metrics:jobStatus.completed"],
      ["failed", 2, "failed"],
    ]);
    expect(result.rows[0]?.fraction).toBeCloseTo(0.6);
    expect(result.rows[1]?.fraction).toBeCloseTo(0.4);
  });

  test("groupBy with bucket yields one gap-filled series per group", async () => {
    const result = await run(byStatusOverTimeMetric, TENANT_A, { range: "7d" });
    expect(result.points).toEqual([]);
    const failed = result.series.find((series) => series.key === "failed");
    expect(failed?.points).toHaveLength(7);
    const failedAt = (iso: string): number | null =>
      failed?.points.find((point) => point.atMs === epochMs(iso))?.value ?? null;
    expect(failedAt("2026-03-09T00:00:00Z")).toBe(1);
    expect(failedAt("2026-03-10T00:00:00Z")).toBe(1);
    expect(failedAt("2026-03-05T00:00:00Z")).toBe(0);
  });

  test("stackBy attaches status segments to every group row", async () => {
    const result = await run(stackedMetric, TENANT_A, { range: "7d" });
    const u2 = result.rows.find((row) => row.key === "u2");
    expect(u2?.value).toBe(2);
    expect(u2?.segments?.map((segment) => [segment.key, segment.value]).sort()).toEqual([
      ["failed", 1],
      ["ok", 1],
    ]);
  });

  test("countDistinct counts users, not events, per day", async () => {
    const result = await run(usersMetric, TENANT_A);
    expect(result.value).toBe(3);
    const valueAt = (iso: string): number | null =>
      result.points.find((point) => point.atMs === epochMs(iso))?.value ?? null;
    expect(valueAt("2026-03-10T00:00:00Z")).toBe(2);
    expect(valueAt("2026-03-09T00:00:00Z")).toBe(2);
    expect(result.previousValue).toBe(1);
  });

  test("comparePrevious: false skips the previous period and its delta", async () => {
    const result = await run(usersWithoutComparisonMetric, TENANT_A);
    expect(result.value).toBe(3);
    expect(result.previousValue).toBeNull();
    expect(result.delta).toBeNull();
  });

  test("sum adds the amount column", async () => {
    const result = await run(amountMetric, TENANT_A, { range: "7d" });
    expect(result.value).toBe(150);
    expect(result.previousValue).toBe(5);
  });

  test("avg leaves empty buckets null instead of zero", async () => {
    const result = await run(averageMetric, TENANT_C);
    expect(result.value).toBe(150);
    const valueAt = (iso: string): number | null =>
      result.points.find((point) => point.atMs === epochMs(iso))?.value ?? null;
    expect(valueAt("2026-03-09T00:00:00Z")).toBe(100);
    expect(valueAt("2026-03-10T00:00:00Z")).toBe(200);
    expect(valueAt("2026-03-05T00:00:00Z")).toBeNull();
  });

  test("timeZone moves the day boundary", async () => {
    const utc = await run(countMetric, TENANT_C, { range: "7d" });
    const berlin = await run(countMetric, TENANT_C, { range: "7d", timeZone: "Europe/Berlin" });
    const lastOf = (result: MetricResult): { atMs: number; value: number | null } | undefined =>
      result.points.at(-1);
    expect(lastOf(utc)).toEqual({ atMs: epochMs("2026-03-10T00:00:00Z"), value: 1 });
    expect(lastOf(berlin)).toEqual({ atMs: epochMs("2026-03-09T23:00:00Z"), value: 2 });
    expect(berlin.points.at(-2)?.atMs).toBe(epochMs("2026-03-09T23:00:00Z") - DAY_MS);
  });

  test("a metric without timeField is a snapshot without window or delta", async () => {
    const result = await run(snapshotMetric, TENANT_A);
    expect(result.value).toBe(4);
    expect(result.windowStartMs).toBeNull();
    expect(result.previousValue).toBeNull();
    expect(result.delta).toBeNull();
    expect(result.points).toEqual([]);
  });

  test("group rows are capped", async () => {
    const result = await run(manyUsersMetric, TENANT_D, { range: "7d" });
    expect(result.value).toBe(55);
    expect(result.rows).toHaveLength(50);
  });

  test("an unknown time zone is rejected", async () => {
    const res = await stack.http.query(
      metricQueryName("tenant", countMetric.id),
      { timeZone: "Mars/Olympus" },
      admin(TENANT_A),
    );
    expect(res.status).toBe(400);
  });

  test("an offset time zone is rejected", async () => {
    for (const timeZone of ["+01:00", "-05:30"]) {
      const res = await stack.http.query(
        metricQueryName("tenant", countMetric.id),
        { timeZone },
        admin(TENANT_A),
      );
      expect(res.status).toBe(400);
    }
  });

  test("an unknown range is rejected", async () => {
    const res = await stack.http.query(
      metricQueryName("tenant", countMetric.id),
      { range: "1y" },
      admin(TENANT_A),
    );
    expect(res.status).toBe(400);
  });
});

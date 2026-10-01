import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { metricQueryName } from "../constants.js";
import { createMetricsFeature, createSystemMetricsFeature } from "../feature.js";
import type { MetricResult } from "../types.js";
import {
  ALL_TEST_METRICS,
  amountMetric,
  countMetric,
  eventsTable,
  fixedClock,
  globalMetric,
  globalTable,
  SYSTEM_ROW_COUNT,
  seedMetricRows,
  snapshotMetric,
  TENANT_A,
  TENANT_B,
} from "./metrics-fixtures.js";

let stack: TestStack;

const tenantAdminA = createTestUser({ id: 7101, tenantId: TENANT_A, roles: ["TenantAdmin"] });
const tenantAdminB = createTestUser({ id: 7102, tenantId: TENANT_B, roles: ["TenantAdmin"] });
const plainUserA = createTestUser({ id: 7103, tenantId: TENANT_A, roles: ["User"] });
const systemAdmin = createTestUser({ id: 7104, tenantId: TENANT_A, roles: ["SystemAdmin"] });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createMetricsFeature({ metrics: ALL_TEST_METRICS, now: fixedClock }),
      createSystemMetricsFeature({ metrics: ALL_TEST_METRICS, now: fixedClock }),
    ],
  });
  await unsafePushTables(stack.db, { eventsTable, globalTable });
  await seedMetricRows(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("metrics tenant isolation", () => {
  test("each tenant sees only its own numbers", async () => {
    const name = metricQueryName("tenant", countMetric.id);
    const a = await stack.http.queryOk<MetricResult>(name, { range: "24h" }, tenantAdminA);
    const b = await stack.http.queryOk<MetricResult>(name, { range: "24h" }, tenantAdminB);
    expect(a.value).toBe(4);
    expect(b.value).toBe(1);
  });

  test("SYSTEM_TENANT_ID rows are excluded from tenant reads", async () => {
    const result = await stack.http.queryOk<MetricResult>(
      metricQueryName("tenant", countMetric.id),
      { range: "24h" },
      tenantAdminA,
    );
    expect(result.value).toBe(4);
    const sum = await stack.http.queryOk<MetricResult>(
      metricQueryName("tenant", amountMetric.id),
      { range: "24h" },
      tenantAdminB,
    );
    expect(sum.value).toBe(1000);
  });

  test("a tenantId in the tenant payload does not widen or redirect the read", async () => {
    const result = await stack.http.queryOk<MetricResult>(
      metricQueryName("tenant", countMetric.id),
      { range: "24h", tenantId: TENANT_B },
      tenantAdminA,
    );
    expect(result.value).toBe(4);
  });

  test("snapshot metrics are tenant-scoped too", async () => {
    const result = await stack.http.queryOk<MetricResult>(
      metricQueryName("tenant", snapshotMetric.id),
      {},
      tenantAdminB,
    );
    expect(result.value).toBe(1);
  });

  test("a plain user cannot read tenant metrics", async () => {
    const res = await stack.http.query(metricQueryName("tenant", countMetric.id), {}, plainUserA);
    expect(res.status).toBe(403);
  });

  test("a TenantAdmin cannot read platform-wide metrics", async () => {
    const res = await stack.http.query(
      metricQueryName("system", countMetric.id),
      { range: "24h" },
      tenantAdminA,
    );
    expect(res.status).toBe(403);
  });

  test("a system-only metric is not exposed on the tenant feature", async () => {
    const res = await stack.http.query(
      metricQueryName("tenant", globalMetric.id),
      {},
      tenantAdminA,
    );
    expect(res.status).toBe(404);
  });

  test("SystemAdmin aggregates across all tenants", async () => {
    const result = await stack.http.queryOk<MetricResult>(
      metricQueryName("system", countMetric.id),
      { range: "24h" },
      systemAdmin,
    );
    // A 4 + B 1 + C 2 + D 55 + SYSTEM rows
    expect(result.value).toBe(62 + SYSTEM_ROW_COUNT);
  });

  test("SystemAdmin can narrow to one tenant", async () => {
    const result = await stack.http.queryOk<MetricResult>(
      metricQueryName("system", countMetric.id),
      { range: "24h", tenantId: TENANT_B },
      systemAdmin,
    );
    expect(result.value).toBe(1);
    expect(result.previousValue).toBe(0);
    expect(result.delta).toBeNull();
  });

  test("a tenant filter on a source without tenant column is a validation error", async () => {
    const all = await stack.http.queryOk<MetricResult>(
      metricQueryName("system", globalMetric.id),
      {},
      systemAdmin,
    );
    expect(all.value).toBe(2);
    const narrowed = await stack.http.query(
      metricQueryName("system", globalMetric.id),
      { tenantId: TENANT_A },
      systemAdmin,
    );
    expect(narrowed.status).toBe(400);
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { insertOne } from "@cosmicdrift/kumiko-framework/db";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { createConfigFeature } from "../../config/index.js";
import { createDeliveryFeature } from "../../delivery/feature.js";
import { deliveryAttemptsTable } from "../../delivery/tables.js";
import { createTenantFeature, tenantEntity } from "../../tenant/index.js";
import { metricQueryName } from "../constants.js";
import { deliveriesByChannelMetric, failedDeliveriesMetric } from "../default-metrics.js";
import { createMetricsFeature, createSystemMetricsFeature } from "../feature.js";
import type { MetricResult } from "../types.js";
import { fixedClock, TENANT_A, TENANT_B } from "./metrics-fixtures.js";

type Attempt = { tenantId: string; channel: string; status: string; createdAt: string };

const attempts: readonly Attempt[] = [
  { tenantId: TENANT_A, channel: "email", status: "sent", createdAt: "2026-03-10T10:10:00Z" },
  { tenantId: TENANT_A, channel: "email", status: "failed", createdAt: "2026-03-10T10:20:00Z" },
  { tenantId: TENANT_A, channel: "in-app", status: "sent", createdAt: "2026-03-10T09:00:00Z" },
  { tenantId: TENANT_A, channel: "email", status: "failed", createdAt: "2026-03-01T09:00:00Z" },
  { tenantId: TENANT_B, channel: "email", status: "failed", createdAt: "2026-03-10T10:30:00Z" },
  { tenantId: TENANT_B, channel: "email", status: "failed", createdAt: "2026-03-10T11:30:00Z" },
];

let stack: TestStack;

const adminA = createTestUser({ id: 7201, tenantId: TENANT_A, roles: ["TenantAdmin"] });
const systemAdmin = createTestUser({ id: 7202, tenantId: TENANT_A, roles: ["SystemAdmin"] });

beforeAll(async () => {
  const metrics = [failedDeliveriesMetric, deliveriesByChannelMetric];
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createDeliveryFeature(),
      createMetricsFeature({ metrics, now: fixedClock }),
      createSystemMetricsFeature({ metrics, now: fixedClock }),
    ],
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  for (const attempt of attempts) {
    await insertOne(stack.db, deliveryAttemptsTable, {
      id: crypto.randomUUID(),
      tenantId: attempt.tenantId,
      notificationType: "metrics:test",
      channel: attempt.channel,
      status: attempt.status,
      createdAt: Temporal.Instant.from(attempt.createdAt),
    });
  }
});

afterAll(async () => {
  await stack.cleanup();
});

describe("default delivery metrics over the real table", () => {
  test("failed-deliveries counts only the caller's failures in the last 24h", async () => {
    const result = await stack.http.queryOk<MetricResult>(
      metricQueryName("tenant", failedDeliveriesMetric.id),
      {},
      adminA,
    );
    expect(result.value).toBe(1);
    expect(result.points).toHaveLength(24);
  });

  test("the system variant sums both tenants", async () => {
    const result = await stack.http.queryOk<MetricResult>(
      metricQueryName("system", failedDeliveriesMetric.id),
      {},
      systemAdmin,
    );
    expect(result.value).toBe(3);
  });

  test("deliveries-by-channel ranks channels and stacks statuses with translated labels", async () => {
    const result = await stack.http.queryOk<MetricResult>(
      metricQueryName("tenant", deliveriesByChannelMetric.id),
      { range: "7d" },
      adminA,
    );
    expect(result.rows.map((row) => [row.key, row.value])).toEqual([
      ["email", 2],
      ["in-app", 1],
    ]);
    const email = result.rows[0];
    expect(
      email?.segments?.map((segment) => [segment.key, segment.label, segment.value]).sort(),
    ).toEqual([
      ["failed", "metrics:deliveryStatus.failed", 1],
      ["sent", "metrics:deliveryStatus.sent", 1],
    ]);
  });
});

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
  FOLDER_A1,
  FOLDER_A2,
  FOLDER_B1,
  filesByKindMetric,
  filesCountMetric,
  filesInFolderTreeMetric,
  filesTable,
  filesWithForeignIdsMetric,
  fixedClock,
  folderTreeTable,
  seedFileRows,
  seedFolderTreeRows,
  TENANT_A,
  TENANT_B,
} from "./metrics-fixtures.js";

let stack: TestStack;

const tenantAdminA = createTestUser({ id: 7201, tenantId: TENANT_A, roles: ["TenantAdmin"] });
const tenantAdminB = createTestUser({ id: 7202, tenantId: TENANT_B, roles: ["TenantAdmin"] });
const systemAdmin = createTestUser({ id: 7203, tenantId: TENANT_A, roles: ["SystemAdmin"] });

const metrics = [
  filesCountMetric,
  filesByKindMetric,
  filesInFolderTreeMetric,
  filesWithForeignIdsMetric,
];
const countName = metricQueryName("tenant", filesCountMetric.id);
const byKindName = metricQueryName("tenant", filesByKindMetric.id);

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createMetricsFeature({ metrics, now: fixedClock }),
      createSystemMetricsFeature({
        metrics: [filesCountMetric, filesByKindMetric],
        now: fixedClock,
      }),
    ],
  });
  await unsafePushTables(stack.db, { filesTable, folderTreeTable });
  await seedFileRows(stack.db);
  await seedFolderTreeRows(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

const count = (payload: Record<string, unknown>, user = tenantAdminA): Promise<MetricResult> =>
  stack.http.queryOk<MetricResult>(countName, payload, user);

describe("metrics filter passthrough", () => {
  test("without a filter each tenant sees only its own rows", async () => {
    expect((await count({})).value).toBe(3);
    expect((await count({}, tenantAdminB)).value).toBe(4);
  });

  test("the tenant's own filter value narrows the result", async () => {
    expect((await count({ folderId: FOLDER_A1 })).value).toBe(2);
    expect((await count({ folderId: FOLDER_A2 })).value).toBe(1);
  });

  test("another tenant's filter value yields zero, never that tenant's number", async () => {
    expect((await count({ folderId: FOLDER_B1 })).value).toBe(0);
    expect((await count({ folderId: FOLDER_A1 }, tenantAdminB)).value).toBe(0);
  });

  test("an empty string and null mean no filter", async () => {
    expect((await count({ folderId: "" })).value).toBe(3);
    expect((await count({ folderId: null })).value).toBe(3);
  });

  test("an invalid uuid is a validation error, not a Postgres 500", async () => {
    const res = await stack.http.query(countName, { folderId: "not-a-uuid" }, tenantAdminA);
    expect(res.status).toBe(400);
  });

  test("a wrongly typed numeric filter is a validation error", async () => {
    const res = await stack.http.query(byKindName, { sizeClass: "big" }, tenantAdminA);
    expect(res.status).toBe(400);
  });

  test("a numeric filter accepts a numeric string and rejects other strings", async () => {
    const asString = await stack.http.queryOk<MetricResult>(
      byKindName,
      { sizeClass: "2" },
      tenantAdminB,
    );
    expect(asString.value).toBe(3);
    const res = await stack.http.query(byKindName, { sizeClass: "2x" }, tenantAdminB);
    expect(res.status).toBe(400);
  });

  test("the metric where stays in force: archived rows never count", async () => {
    expect((await count({ folderId: FOLDER_A2 })).value).toBe(1);
  });

  test("filters apply to grouped rows and combine with each other", async () => {
    const all = await stack.http.queryOk<MetricResult>(byKindName, {}, tenantAdminA);
    expect(all.rows.map((row) => [row.key, row.value]).sort()).toEqual([
      ["pdf", 2],
      ["png", 1],
    ]);
    const narrowed = await stack.http.queryOk<MetricResult>(
      byKindName,
      { folderId: FOLDER_A1, kind: "pdf" },
      tenantAdminA,
    );
    expect(narrowed.rows.map((row) => [row.key, row.value])).toEqual([["pdf", 1]]);
    const numeric = await stack.http.queryOk<MetricResult>(
      byKindName,
      { sizeClass: 2 },
      tenantAdminB,
    );
    expect(numeric.value).toBe(3);
  });

  test("the system feature accepts the filter and still honors the tenant narrowing", async () => {
    const name = metricQueryName("system", filesCountMetric.id);
    const platform = await stack.http.queryOk<MetricResult>(name, {}, systemAdmin);
    expect(platform.value).toBe(7);
    const folder = await stack.http.queryOk<MetricResult>(
      name,
      { folderId: FOLDER_B1 },
      systemAdmin,
    );
    expect(folder.value).toBe(4);
    const crossTenant = await stack.http.queryOk<MetricResult>(
      name,
      { folderId: FOLDER_B1, tenantId: TENANT_A },
      systemAdmin,
    );
    expect(crossTenant.value).toBe(0);
  });
});

describe("metrics filter resolvers", () => {
  const treeName = metricQueryName("tenant", filesInFolderTreeMetric.id);
  const tree = (payload: Record<string, unknown>, user = tenantAdminA): Promise<MetricResult> =>
    stack.http.queryOk<MetricResult>(treeName, payload, user);

  test("the resolver's ids narrow the result (folder plus subfolder)", async () => {
    expect((await tree({})).value).toBe(3);
    expect((await tree({ treeFolderId: FOLDER_A1 })).value).toBe(3);
    expect((await tree({ treeFolderId: "" })).value).toBe(3);
  });

  test("an empty resolver result yields zero", async () => {
    expect((await tree({ treeFolderId: FOLDER_A2 })).value).toBe(0);
  });

  test("another tenant's folder id yields zero because the resolver only sees own assignments", async () => {
    expect((await tree({ treeFolderId: FOLDER_B1 })).value).toBe(0);
    expect((await tree({ treeFolderId: FOLDER_B1 }, tenantAdminB)).value).toBe(4);
  });

  test("a resolver returning foreign ids still cannot widen beyond the tenant scope", async () => {
    const name = metricQueryName("tenant", filesWithForeignIdsMetric.id);
    const own = await stack.http.queryOk<MetricResult>(name, { anyFolder: "x" }, tenantAdminA);
    expect(own.value).toBe(0);
  });

  test("an invalid payload value is a validation error", async () => {
    const res = await stack.http.query(treeName, { treeFolderId: "nope" }, tenantAdminA);
    expect(res.status).toBe(400);
  });
});

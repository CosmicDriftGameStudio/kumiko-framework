// Catalog + trigger hardening — manual and maintenance jobs only.
// Real HTTP via setupTestStack — no mocks, mirrors jobs-security.integration.test.ts.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  testRunQueueNamePrefix,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createJobsFeature } from "../feature.ts";
import { jobRunLogsTable, jobRunsTable } from "../job-run-table.ts";
import { JobErrors, JobHandlers, JobQueries } from "../web/constants.ts";

let stack: TestStack;

const systemAdmin = TestUsers.systemAdmin;
const tenantAdmin = createTestUser({ id: 3, roles: ["TenantAdmin"] });

const appFeature = defineFeature("catalog-app", (r) => {
  r.job({
    name: "manualEcho",
    trigger: { manual: true },
    schema: z.object({ entity: z.string().min(1) }),
    handler: async () => {},
  });
  r.job({ name: "cronOnly", trigger: { cron: "0 * * * *" }, handler: async () => {} });
  r.job({ name: "dailyCleanup", trigger: { maintenance: true }, handler: async () => {} });
});

beforeAll(async () => {
  stack = await setupTestStack({
    features: [appFeature, createJobsFeature()],
    jobs: {
      consumerLane: "worker",
      queueNamePrefix: testRunQueueNamePrefix("kumiko-jobs-catalog-test"),
    },
  });
  await unsafePushTables(stack.db, { jobRunsTable, jobRunLogsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("jobs:query:catalog", () => {
  test("lists manual and maintenance jobs including framework builtins", async () => {
    type CatalogRow = {
      readonly jobName: string;
      readonly perTenant: boolean;
      readonly payloadSchema: Record<string, unknown> | null;
    };
    const result = await stack.http.queryOk<{ rows: readonly CatalogRow[] }>(
      JobQueries.catalog,
      {},
      systemAdmin,
    );
    const names = result.rows.map((r) => r.jobName);
    expect(names).toContain("catalog-app:job:manual-echo");
    expect(names).toContain("jobs:job:reindex-entity");
    expect(names).toContain("jobs:job:projection-rebuild");
    expect(names).toContain("catalog-app:job:daily-cleanup");
    expect(names).not.toContain("catalog-app:job:cron-only");

    const echo = result.rows.find((r) => r.jobName === "catalog-app:job:manual-echo");
    expect(echo).toBeDefined();
    expect(echo?.payloadSchema).not.toBeNull();

    const reindex = result.rows.find((r) => r.jobName === "jobs:job:reindex-entity");
    expect(reindex?.perTenant).toBe(true);
  });
});

describe("jobs:write:trigger hardening", () => {
  test("rejects cron-only jobs", async () => {
    const err = await stack.http.writeErr(
      JobHandlers.trigger,
      { jobName: "catalog-app:job:cron-only" },
      systemAdmin,
    );
    expect(err.code).toBe("unprocessable");
    expect(err.details).toMatchObject({ reason: JobErrors.notManual });
  });

  test("starts a maintenance job on demand", async () => {
    const result = await stack.http.writeOk<{ jobName: string; bullJobId: string }>(
      JobHandlers.trigger,
      { jobName: "catalog-app:job:daily-cleanup" },
      systemAdmin,
    );
    expect(result.jobName).toBe("catalog-app:job:daily-cleanup");
  });

  test("a TenantAdmin cannot start a maintenance job", async () => {
    const res = await stack.http.write(
      JobHandlers.trigger,
      { jobName: "catalog-app:job:daily-cleanup" },
      tenantAdmin,
    );
    expect(res.status).toBe(403);
  });

  test.each([
    ["broken JSON", "{not json"],
    ["JSON array", "[1,2]"],
    ["JSON null", "null"],
  ])(
    "rejects non-object payload string (%s) with invalidPayload, not notManual",
    async (_label, payload) => {
      const err = await stack.http.writeErr(
        JobHandlers.trigger,
        { jobName: "catalog-app:job:manual-echo", payload },
        systemAdmin,
      );
      expect(err.code).toBe("unprocessable");
      expect(err.details).toMatchObject({ reason: JobErrors.invalidPayload });
    },
  );

  test("rejects invalid payload against job schema", async () => {
    const err = await stack.http.writeErr(
      JobHandlers.trigger,
      { jobName: "catalog-app:job:manual-echo", payload: {} },
      systemAdmin,
    );
    expect(err.code).toBe("validation_error");
  });

  test("accepts valid schema payload", async () => {
    const result = await stack.http.writeOk<{ jobName: string; bullJobId: string }>(
      JobHandlers.trigger,
      { jobName: "catalog-app:job:manual-echo", payload: { entity: "credit" } },
      systemAdmin,
    );
    expect(result.jobName).toBe("catalog-app:job:manual-echo");
  });
});

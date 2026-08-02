// Catalog + trigger hardening for #1602 — manual-only surface.
// Real HTTP via setupTestStack — no mocks, mirrors jobs-security.integration.test.ts.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { z } from "zod";
import { JobErrors, JobHandlers, JobQueries } from "../constants";
import { createJobsFeature } from "../feature";
import { jobRunLogsTable, jobRunsTable } from "../job-run-table";

let stack: TestStack;

const systemAdmin = TestUsers.systemAdmin;

const appFeature = defineFeature("catalog-app", (r) => {
  r.job(
    "manualEcho",
    { trigger: { manual: true }, schema: z.object({ entity: z.string().min(1) }) },
    async () => {},
  );
  r.job("cronOnly", { trigger: { cron: "0 * * * *" } }, async () => {});
});

beforeAll(async () => {
  stack = await setupTestStack({
    features: [appFeature, createJobsFeature()],
    jobs: { consumerLane: "worker", queueNamePrefix: `kumiko-jobs-catalog-test-${Date.now()}` },
  });
  await unsafePushTables(stack.db, { jobRunsTable, jobRunLogsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("jobs:query:catalog", () => {
  test("lists only manual jobs including framework builtins", async () => {
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

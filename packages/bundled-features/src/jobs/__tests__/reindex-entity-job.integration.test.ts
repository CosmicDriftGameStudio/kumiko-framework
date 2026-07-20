// #1215: the `jobs` feature registers `reindexEntity` as a manual + perTenant
// job. perTenant jobs fan out through a BullMQ wrapper that needs
// `getActiveTenantIds` (job-runner.ts) — setupTestStack's jobRunner doesn't
// wire that, so this calls the exported handler directly with a constructed
// context instead of going through jobRunner.dispatch(), same as
// inbound-mail-foundation's retention job test calls its sweep function
// directly rather than round-tripping through the queue.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  type JobContext,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { bridgeStub } from "@cosmicdrift/kumiko-framework/testing";
import { createJobsFeature } from "../feature";
import { reindexEntityJob } from "../handlers/reindex-entity.job";

// Resolved job name — operators trigger this via jobs:write:trigger with
// { jobName: "jobs:job:reindex-entity", payload: { entity: "..." } }.
const REINDEX_ENTITY_JOB = "jobs:job:reindex-entity";

const widgetEntity = createEntity({
  table: "read_reindex_job_widgets",
  fields: {
    name: createTextField({ required: true, searchable: true }),
  },
});

const widgetTable = buildEntityTable("widget", widgetEntity);

const widgetFeature = defineFeature("reindex-job-test", (r) => {
  r.entity("widget", widgetEntity);
});

let stack: TestStack;
const admin = TestUsers.admin;

const noopLogger: JobContext["log"] = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return noopLogger;
  },
};

beforeAll(async () => {
  stack = await setupTestStack({ features: [widgetFeature, createJobsFeature()] });
  await unsafeCreateEntityTable(stack.db, widgetEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("jobs feature: reindexEntity registration", () => {
  test("registers reindexEntity as jobs:job:reindex-entity — the name jobs:write:trigger dispatches by", () => {
    const job = stack.registry.getJob(REINDEX_ENTITY_JOB);
    expect(job).toBeDefined();
    expect(job?.handler).toBe(reindexEntityJob);
    expect(job?.perTenant).toBe(true);
    expect(job?.trigger).toEqual({ manual: true });
  });
});

describe("reindexEntityJob", () => {
  test("indexes rows for the tenant resolved from ctx.systemUser", async () => {
    const executor = createEventStoreExecutor(widgetTable, widgetEntity, { entityName: "widget" });
    const tenantDb = createTenantDb(stack.db, admin.tenantId, "system");
    const created = await executor.create({ name: "Job Backfillable Widget" }, admin, tenantDb);
    if (!created.isSuccess) throw new Error("seed failed");

    // No stack.eventDispatcher.runOnce() — row was never indexed live.
    const preResults = await stack.search.search(admin.tenantId, "backfillable", {
      filterType: "widget",
    });
    expect(preResults).toHaveLength(0);

    await reindexEntityJob(
      { entity: "widget" },
      { db: stack.db, registry: stack.registry, searchAdapter: stack.search, systemUser: admin },
    );

    const postResults = await stack.search.search(admin.tenantId, "backfillable", {
      filterType: "widget",
    });
    expect(postResults.some((r) => r.entityId === created.data.id)).toBe(true);
  });

  test("the registered job handler resolves a systemUser-scoped fan-out run and actually indexes (not reindexEntityJob called directly)", async () => {
    // The two direct-call tests above bypass jobRunner.dispatch()'s
    // ctx-resolution/guard chain entirely — a bug there (e.g. a systemUser
    // that isn't wired through) would be invisible to them. Invoke the
    // ACTUAL registered handler, same as retention-cleanup's handler test.
    const executor = createEventStoreExecutor(widgetTable, widgetEntity, { entityName: "widget" });
    const tenantDb = createTenantDb(stack.db, admin.tenantId, "system");
    const created = await executor.create({ name: "Registry-Resolved Widget" }, admin, tenantDb);
    if (!created.isSuccess) throw new Error("seed failed");

    const preResults = await stack.search.search(admin.tenantId, "registry-resolved", {
      filterType: "widget",
    });
    expect(preResults).toHaveLength(0);

    const job = stack.registry.getJob(REINDEX_ENTITY_JOB);
    expect(job).toBeDefined();
    if (!job) return;

    const ctx: JobContext = {
      db: stack.db,
      registry: stack.registry,
      searchAdapter: stack.search,
      systemUser: admin,
      log: noopLogger,
      triggeredBy: null,
      ...bridgeStub(),
    };
    await job.handler({ entity: "widget" }, ctx);

    const postResults = await stack.search.search(admin.tenantId, "registry-resolved", {
      filterType: "widget",
    });
    expect(postResults.some((r) => r.entityId === created.data.id)).toBe(true);
  });

  test("skips silently when no tenant is resolvable (fan-out misfire)", async () => {
    await expect(
      reindexEntityJob(
        { entity: "widget" },
        { db: stack.db, registry: stack.registry, searchAdapter: stack.search },
      ),
    ).resolves.toBeUndefined();
  });

  test("throws when ctx.searchAdapter is missing", async () => {
    await expect(
      reindexEntityJob(
        { entity: "widget" },
        { db: stack.db, registry: stack.registry, systemUser: admin },
      ),
    ).rejects.toThrow(/searchAdapter/);
  });
});

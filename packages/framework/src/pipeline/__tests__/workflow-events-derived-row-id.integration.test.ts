// A projection whose rows are keyed by an id DERIVED from the source event
// (tenant-salted uuidv5) declares it as `rowIdOf`; the rebuild's ghost-row guard
// then checks live rows against the derived ids. workflowRunAggregateId does not
// fold in the tenant, so two tenants can record the same run id.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { v5 as uuidv5 } from "uuid";
import * as z from "zod";
import { insertOne, selectMany } from "../../db/query.js";
import { buildEntityTable } from "../../db/table-builder.js";
import {
  createEntity,
  createTextField,
  defineFeature,
  WORKFLOW_AGGREGATE_TYPE,
  WORKFLOW_RUN_STARTED_TYPE,
} from "../../engine/index.js";
import { rebuildProjection } from "../../pipeline/index.js";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack/index.js";

const SALTED_ROW_ID_NAMESPACE = "9b2c6f0e-5d1a-4e83-a7b4-3c8d2e1f0a96";

function saltedRowId(source: { readonly tenantId: string; readonly aggregateId: string }): string {
  return uuidv5(`${source.tenantId}|${source.aggregateId}`, SALTED_ROW_ID_NAMESPACE);
}

const runViewEntity = createEntity({
  table: "read_wf_salted_run_views",
  fields: {
    workflowName: createTextField({ personal: false, reason: "test_fixture", required: true }),
    status: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const runViewTable = buildEntityTable("wf-salted-run-view", runViewEntity);
// @cast-boundary test-fixture — the apply handler writes the entity table the way
// the replay does; the brand only guards ad-hoc writes outside projections.
const writableRunViewTable = runViewTable as unknown as Parameters<typeof insertOne>[1];

const PROJECTION_NAME = "wfsalted:projection:wf-salted-run-view-entity";

const workflowViewFeature = defineFeature("wfsalted", (r) => {
  r.entity("wf-salted-run-view", runViewEntity);
  r.extendEntityProjection("wf-salted-run-view", {
    sources: [WORKFLOW_AGGREGATE_TYPE],
    rowIdOf: saltedRowId,
    apply: {
      [WORKFLOW_RUN_STARTED_TYPE]: async (event, tx) => {
        const payload = event.payload as { workflowName: string };
        await insertOne(tx, writableRunViewTable, {
          id: saltedRowId(event),
          tenantId: event.tenantId,
          version: event.version,
          insertedAt: event.createdAt,
          insertedById: event.createdBy,
          workflowName: payload.workflowName,
          status: "running",
        });
      },
    },
  });

  r.writeHandler(
    "run:record",
    z.object({ runId: z.uuid() }),
    async (event, ctx) => {
      await ctx.unsafeAppendEvent({
        aggregateId: event.payload.runId,
        aggregateType: WORKFLOW_AGGREGATE_TYPE,
        type: WORKFLOW_RUN_STARTED_TYPE,
        payload: { workflowName: "invoice-reminder", triggerEventType: "billing:event:overdue" },
      });
      return { isSuccess: true as const, data: {} };
    },
    { access: { roles: ["Admin"] } },
  );
});

let stack: TestStack;
const tenantA = TestUsers.admin;
const tenantB = TestUsers.otherTenant;

beforeAll(async () => {
  stack = await setupTestStack({ features: [workflowViewFeature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, runViewEntity, "wf-salted-run-view");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetEventStore(stack, ["read_wf_salted_run_views"]);
});

async function seedLiveRow(id: string, tenantId: string): Promise<void> {
  await insertOne(stack.db, writableRunViewTable, {
    id,
    tenantId,
    version: 1,
    workflowName: "invoice-reminder",
    status: "running",
  });
}

async function runRows(): Promise<readonly Record<string, unknown>[]> {
  const rows = await selectMany(
    stack.db,
    runViewTable,
    {},
    { orderBy: { col: "id", direction: "asc" } },
  );
  return rows.map((row) => ({
    id: row["id"],
    tenantId: row["tenantId"],
    workflowName: row["workflowName"],
    status: row["status"],
    version: row["version"],
  }));
}

async function recordSharedRun(): Promise<string> {
  const runId = crypto.randomUUID();
  await stack.http.writeOk("wfsalted:write:run:record", { runId }, tenantA);
  await stack.http.writeOk("wfsalted:write:run:record", { runId }, tenantB);
  return runId;
}

const GHOST_ERROR = /live rows in ".*" have no\s+event in the projection's source streams/;

describe("rowIdOf on r.extendEntityProjection", () => {
  test("rows keyed by the derived id survive the rebuild, even when two tenants share a run id", async () => {
    const runId = await recordSharedRun();
    await seedLiveRow(
      saltedRowId({ tenantId: tenantA.tenantId, aggregateId: runId }),
      tenantA.tenantId,
    );
    await seedLiveRow(
      saltedRowId({ tenantId: tenantB.tenantId, aggregateId: runId }),
      tenantB.tenantId,
    );
    const before = await runRows();

    const result = await rebuildProjection(PROJECTION_NAME, {
      db: stack.db,
      registry: stack.registry,
    });

    expect(result.eventsProcessed).toBe(2);
    const after = await runRows();
    expect(after).toHaveLength(2);
    expect(after).toEqual(before);
  });

  test("a live row with a random id still aborts the rebuild", async () => {
    const runId = await recordSharedRun();
    await seedLiveRow(
      saltedRowId({ tenantId: tenantA.tenantId, aggregateId: runId }),
      tenantA.tenantId,
    );
    const ghostId = crypto.randomUUID();
    await seedLiveRow(ghostId, tenantA.tenantId);

    await expect(
      rebuildProjection(PROJECTION_NAME, { db: stack.db, registry: stack.registry }),
    ).rejects.toThrow(GHOST_ERROR);
    expect((await runRows()).map((row) => row["id"])).toContain(ghostId);
  });

  test("a live row keyed by the raw run id aborts: the guard stays strict for derived sources", async () => {
    const runId = await recordSharedRun();
    await seedLiveRow(
      saltedRowId({ tenantId: tenantA.tenantId, aggregateId: runId }),
      tenantA.tenantId,
    );
    await seedLiveRow(runId, tenantA.tenantId);

    await expect(
      rebuildProjection(PROJECTION_NAME, { db: stack.db, registry: stack.registry }),
    ).rejects.toThrow(GHOST_ERROR);
    expect((await runRows()).map((row) => row["id"])).toContain(runId);
  });
});

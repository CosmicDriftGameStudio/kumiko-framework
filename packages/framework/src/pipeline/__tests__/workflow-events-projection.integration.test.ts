// Projections on the registered `kumiko:system:workflow.*` events: a row whose
// id is the workflow-run aggregate id must survive an official rebuild. Before
// the workflow events were registered, such an apply-key failed boot
// validation, so the row could only be fed outside the replay and the ghost-row
// guard aborted the rebuild.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as z from "zod";
import { insertOne, selectMany, updateMany } from "../../db/query.js";
import { buildEntityTable } from "../../db/table-builder.js";
import {
  createEntity,
  createTextField,
  defineFeature,
  WORKFLOW_AGGREGATE_TYPE,
  WORKFLOW_RUN_FAILED_TYPE,
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

const runViewEntity = createEntity({
  table: "read_wf_run_views",
  fields: {
    workflowName: createTextField({ personal: false, reason: "test_fixture", required: true }),
    status: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const runViewTable = buildEntityTable("wf-run-view", runViewEntity);
// @cast-boundary test-fixture — the apply handlers write the entity table the way
// the replay does; the brand only guards ad-hoc writes outside projections.
const writableRunViewTable = runViewTable as unknown as Parameters<typeof insertOne>[1];

const PROJECTION_NAME = "wfview:projection:wf-run-view-entity";

const workflowViewFeature = defineFeature("wfview", (r) => {
  r.entity("wf-run-view", runViewEntity);
  r.extendEntityProjection("wf-run-view", {
    sources: [WORKFLOW_AGGREGATE_TYPE],
    apply: {
      [WORKFLOW_RUN_STARTED_TYPE]: async (event, tx) => {
        const payload = event.payload as { workflowName: string };
        await insertOne(tx, writableRunViewTable, {
          id: event.aggregateId,
          tenantId: event.tenantId,
          version: event.version,
          insertedAt: event.createdAt,
          insertedById: event.createdBy,
          workflowName: payload.workflowName,
          status: "running",
        });
      },
      [WORKFLOW_RUN_FAILED_TYPE]: async (event, tx) => {
        await updateMany(
          tx,
          writableRunViewTable,
          { status: "failed", version: event.version },
          { id: event.aggregateId },
        );
      },
    },
  });

  r.writeHandler(
    "run:record",
    z.object({ runId: z.uuid(), fail: z.boolean() }),
    async (event, ctx) => {
      await ctx.unsafeAppendEvent({
        aggregateId: event.payload.runId,
        aggregateType: WORKFLOW_AGGREGATE_TYPE,
        type: WORKFLOW_RUN_STARTED_TYPE,
        payload: { workflowName: "invoice-reminder", triggerEventType: "billing:event:overdue" },
      });
      if (event.payload.fail) {
        await ctx.unsafeAppendEvent({
          aggregateId: event.payload.runId,
          aggregateType: WORKFLOW_AGGREGATE_TYPE,
          type: WORKFLOW_RUN_FAILED_TYPE,
          payload: { workflowName: "invoice-reminder", stepIndex: 0, error: "Error" },
        });
      }
      return { isSuccess: true as const, data: {} };
    },
    { access: { roles: ["Admin"] } },
  );
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [workflowViewFeature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, runViewEntity, "wf-run-view");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetEventStore(stack, ["read_wf_run_views"]);
});

// The implicit entity projection has no live apply (the live row comes from a
// separate path, e.g. an MSP sync), so the test seeds the live rows the way
// that path would: id = run aggregate id, state = what the stream implies.
async function seedLiveRow(id: string, status: string, version: number): Promise<void> {
  await insertOne(stack.db, writableRunViewTable, {
    id,
    tenantId: admin.tenantId,
    version,
    workflowName: "invoice-reminder",
    status,
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
    workflowName: row["workflowName"],
    status: row["status"],
    version: row["version"],
  }));
}

describe("projection on registered workflow events", () => {
  test("live rows keyed by the run id survive the rebuild unchanged", async () => {
    const completedRun = crypto.randomUUID();
    const failedRun = crypto.randomUUID();
    await stack.http.writeOk(
      "wfview:write:run:record",
      { runId: completedRun, fail: false },
      admin,
    );
    await stack.http.writeOk("wfview:write:run:record", { runId: failedRun, fail: true }, admin);
    await seedLiveRow(completedRun, "running", 1);
    await seedLiveRow(failedRun, "failed", 2);
    const before = await runRows();

    const result = await rebuildProjection(PROJECTION_NAME, {
      db: stack.db,
      registry: stack.registry,
    });

    expect(result.eventsProcessed).toBe(3);
    const after = await runRows();
    expect(after).toHaveLength(2);
    expect(after).toEqual(before);
  });

  test("a live row without a backing event still aborts the rebuild", async () => {
    const runId = crypto.randomUUID();
    await stack.http.writeOk("wfview:write:run:record", { runId, fail: false }, admin);
    await seedLiveRow(runId, "running", 1);
    const ghostId = crypto.randomUUID();
    await seedLiveRow(ghostId, "running", 1);

    await expect(
      rebuildProjection(PROJECTION_NAME, { db: stack.db, registry: stack.registry }),
    ).rejects.toThrow(/live rows in ".*" have no\s+event in the projection's source streams/);
    expect((await runRows()).map((row) => row["id"])).toContain(ghostId);
  });
});

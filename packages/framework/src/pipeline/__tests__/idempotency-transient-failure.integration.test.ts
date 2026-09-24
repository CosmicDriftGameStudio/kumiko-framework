import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { asRawClient, selectMany } from "../../db/query";
import { buildEntityTable } from "../../db/table-builder";
import { createEntity, createTextField, defineFeature } from "../../engine";
import { UnprocessableError, writeFailure } from "../../errors";
import { setupTestStack, type TestStack, TestUsers, unsafeCreateEntityTable } from "../../stack";

const probeEntity = createEntity({
  table: "idempotency_transient_probes",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const probeTable = buildEntityTable("probe", probeEntity);

const batchItemEntity = createEntity({
  table: "idempotency_transient_batch_items",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const batchItemTable = buildEntityTable("batchItem", batchItemEntity);

// Reset per test — counts real handler invocations so a cached replay
// (no re-invocation) is distinguishable from a genuine retry.
let transientCallCount = 0;
let unprocessableCallCount = 0;
let batchTransientCallCount = 0;

const transientFailureFeature = defineFeature("idempotencytransient", (r) => {
  r.entity("probe", probeEntity);
  r.entity("batchItem", batchItemEntity);

  // Inserts via ctx.db, then throws on its first invocation only — the
  // insert lands inside the (later rolled-back) transaction, so a retry
  // must not see a leftover row from the failed attempt.
  r.writeHandler(
    "probe:create-transient-once",
    z.object({ label: z.string() }),
    async (event, ctx) => {
      transientCallCount++;
      const crud = createEventStoreExecutor(probeTable, probeEntity, { entityName: "probe" });
      const created = await crud.create(event.payload, event.user, ctx.db);
      if (transientCallCount === 1) {
        throw new Error("transient boom");
      }
      return created;
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "probe:create-always-rejected",
    z.object({ label: z.string() }),
    async () => {
      unprocessableCallCount++;
      return writeFailure(new UnprocessableError("always_rejected"));
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "batch-item:create",
    z.object({ label: z.string() }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(batchItemTable, batchItemEntity, {
        entityName: "batchItem",
      });
      return crud.create(event.payload, event.user, ctx.db);
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "probe:create-batch-transient-once",
    z.object({ label: z.string() }),
    async (event, ctx) => {
      batchTransientCallCount++;
      const crud = createEventStoreExecutor(probeTable, probeEntity, { entityName: "probe" });
      const created = await crud.create(event.payload, event.user, ctx.db);
      if (batchTransientCallCount === 1) {
        throw new Error("transient boom in batch");
      }
      return created;
    },
    { access: { roles: ["Admin"] } },
  );
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [transientFailureFeature] });
  await unsafeCreateEntityTable(stack.db, probeEntity);
  await unsafeCreateEntityTable(stack.db, batchItemEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  transientCallCount = 0;
  unprocessableCallCount = 0;
  batchTransientCallCount = 0;
  await asRawClient(stack.db).unsafe(`DELETE FROM "${probeTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${batchItemTable.tableName}"`);
  await stack.redis.flushNamespace();
});

describe("idempotent retry after a rolled-back transient 5xx", () => {
  test("write: first call fails with internal_error, retry with the same requestId succeeds", async () => {
    const requestId = "req-transient-5xx-1";

    const first = await stack.http.write(
      "idempotencytransient:write:probe:create-transient-once",
      { label: "attempt-1" },
      admin,
      requestId,
    );
    const firstBody = (await first.json()) as { isSuccess: boolean; error?: { code?: string } };
    expect(firstBody.isSuccess).toBe(false);
    expect(firstBody.error?.code).toBe("internal_error");

    const second = await stack.http.write(
      "idempotencytransient:write:probe:create-transient-once",
      { label: "attempt-1" },
      admin,
      requestId,
    );
    const secondBody = (await second.json()) as { isSuccess: boolean };
    expect(secondBody.isSuccess).toBe(true);

    expect(transientCallCount).toBe(2);
    const rows = await selectMany(stack.db, probeTable);
    expect(rows).toHaveLength(1);
  });

  test("write: a deterministic 4xx rejection stays cached — retry returns the identical body without re-invoking the handler", async () => {
    const requestId = "req-4xx-cached-1";

    const first = await stack.http.write(
      "idempotencytransient:write:probe:create-always-rejected",
      { label: "rejected" },
      admin,
      requestId,
    );
    const firstBody = (await first.json()) as {
      isSuccess: boolean;
      error?: { code?: string; message?: string; details?: unknown };
    };

    const second = await stack.http.write(
      "idempotencytransient:write:probe:create-always-rejected",
      { label: "rejected" },
      admin,
      requestId,
    );
    const secondBody = (await second.json()) as typeof firstBody;

    // Compare the cached payload, not the wire envelope — the response
    // carries a fresh per-HTTP-call requestId/timestamp on every replay,
    // both from the same cached idempotency entry.
    expect(secondBody.isSuccess).toBe(false);
    expect(secondBody.error?.code).toEqual(firstBody.error?.code);
    expect(secondBody.error?.message).toEqual(firstBody.error?.message);
    expect(secondBody.error?.details).toEqual(firstBody.error?.details);
    expect(unprocessableCallCount).toBe(1);
  });

  test("batch: a rolled-back transient 5xx on one command doesn't block a retry, and the rolled-back first command lands exactly once", async () => {
    const requestId = "req-batch-transient-5xx-1";
    const commands = [
      { type: "idempotencytransient:write:batch-item:create", payload: { label: "item-1" } },
      {
        type: "idempotencytransient:write:probe:create-batch-transient-once",
        payload: { label: "probe-1" },
      },
    ];

    const first = await stack.http.batch(commands, admin, requestId);
    const firstBody = (await first.json()) as { isSuccess: boolean };
    expect(firstBody.isSuccess).toBe(false);

    const second = await stack.http.batch(commands, admin, requestId);
    const secondBody = (await second.json()) as { isSuccess: boolean };
    expect(secondBody.isSuccess).toBe(true);

    expect(batchTransientCallCount).toBe(2);
    const batchItems = await selectMany(stack.db, batchItemTable);
    expect(batchItems).toHaveLength(1);
    const probes = await selectMany(stack.db, probeTable);
    expect(probes).toHaveLength(1);
  });
});

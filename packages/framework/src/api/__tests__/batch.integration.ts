import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createCrudExecutor } from "../../db/crud-executor";
import { buildDrizzleTable } from "../../db/table-builder";
import {
  createEntity,
  createNumberField,
  createTextField,
  defineFeature,
  HookPhases,
  type SaveContext,
} from "../../engine";
import { UnprocessableError, writeFailure } from "../../errors";
import { createEntityTable, setupTestStack, type TestStack, TestUsers } from "../../testing";

// Entity: a simple "item" with name + counter
const itemEntity = createEntity({
  table: "batch_items",
  fields: {
    name: createTextField({ required: true }),
    counter: createNumberField({ default: 0 }),
  },
});

const itemTable = buildDrizzleTable("item", itemEntity);

// Second entity used by an inTransaction hook to prove that hook DB writes
// roll back with the main transaction.
const auditEntity = createEntity({
  table: "batch_audit",
  fields: {
    action: createTextField({ required: true }),
    itemId: createNumberField({ required: true }),
  },
});
const auditTable = buildDrizzleTable("audit", auditEntity);

// Hook invocation logs — reset per test. Captures which phase each hook saw.
const inTxHookLog: Array<{ id: number; name: string }> = [];
const afterCommitHookLog: Array<{ id: number; name: string }> = [];

// Toggles for afterCommit fault-injection test
let afterCommitShouldThrow = false;
const afterCommitThirdHookRan: string[] = [];

const itemFeature = defineFeature("batch", (r) => {
  const item = r.entity("item", itemEntity);

  r.writeHandler(
    "item:create",
    z.object({ name: z.string().min(1), counter: z.number().optional() }),
    async (event, ctx) => {
      const crud = createCrudExecutor(itemTable, itemEntity, { entityName: "item" });
      return crud.create(event.payload, event.user, ctx.db);
    },
    { access: { roles: ["Admin"] } },
  );

  // Handler that always fails validation — used to trigger rollback mid-batch
  r.writeHandler(
    "item:fail",
    z.object({ name: z.string().min(1) }),
    async () => writeFailure(new UnprocessableError("intentional_failure")),
    { access: { roles: ["Admin"] } },
  );

  // Handler that always throws — used to verify unexpected throws surface as failures
  r.writeHandler(
    "item:throw",
    z.object({ name: z.string().min(1) }),
    async () => {
      throw new Error("handler_crashed");
    },
    { access: { roles: ["Admin"] } },
  );

  // Entity hook: inTransaction — records in memory
  r.entityHook(
    "postSave",
    item,
    async (result: SaveContext) => {
      inTxHookLog.push({ id: result.id, name: (result.data["name"] as string) ?? "" });
    },
    { phase: HookPhases.inTransaction },
  );

  // Entity hook: inTransaction — writes to DB via ctx.db (the tx-scoped TenantDb).
  // Proves that hook DB writes roll back with the main transaction on failure.
  r.entityHook(
    "postSave",
    item,
    async (result, ctx) => {
      if (!ctx.db) return;
      await ctx.db
        .insert(auditTable)
        .values({ action: "item_saved", itemId: result.id })
        .returning();
    },
    { phase: HookPhases.inTransaction },
  );

  // Entity hook: afterCommit — records in memory (default phase)
  r.entityHook("postSave", item, async (result: SaveContext) => {
    afterCommitHookLog.push({ id: result.id, name: (result.data["name"] as string) ?? "" });
  });

  // Entity hook: afterCommit — may throw, used to verify error isolation
  r.entityHook("postSave", item, async () => {
    if (afterCommitShouldThrow) throw new Error("afterCommit_boom");
  });

  // Entity hook: afterCommit — runs AFTER the throwing one. Used to prove the
  // next hooks still fire despite the earlier failure.
  r.entityHook("postSave", item, async (result: SaveContext) => {
    afterCommitThirdHookRan.push((result.data["name"] as string) ?? "");
  });

  // Two hooks used by the parallelism test. Each records its start+end
  // timestamps so the assertion can compare intervals rather than elapsed
  // wall-clock time (which is timing-flaky on loaded CI boxes).
  r.entityHook("postSave", item, async (result: SaveContext) => {
    const name = result.data["name"] as string;
    if (!name?.startsWith("slowness-")) return;
    parallelismWindows.push({ hook: "A", start: Date.now() });
    await new Promise((r) => setTimeout(r, 80));
    parallelismWindows.push({ hook: "A", end: Date.now() });
  });
  r.entityHook("postSave", item, async (result: SaveContext) => {
    const name = result.data["name"] as string;
    if (!name?.startsWith("slowness-")) return;
    parallelismWindows.push({ hook: "B", start: Date.now() });
    await new Promise((r) => setTimeout(r, 80));
    parallelismWindows.push({ hook: "B", end: Date.now() });
  });
});

// Start + end timestamps recorded by the parallelism hooks above. A pair of
// hooks that ran truly in parallel will show B.start < A.end (and vice-versa),
// regardless of how long the whole request took overall.
//
// Module-level mutable state — safe here because Vitest runs tests inside a
// single file sequentially (the default). If someone flips vitest's
// `sequence.concurrent` on for this file, the test body would need its own
// window collector passed through ctx instead.
type ParallelismEvent = { hook: "A" | "B"; start?: number; end?: number };
const parallelismWindows: ParallelismEvent[] = [];

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [itemFeature] });
  await createEntityTable(stack.db.db, itemEntity);
  await createEntityTable(stack.db.db, auditEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  inTxHookLog.length = 0;
  afterCommitHookLog.length = 0;
  afterCommitThirdHookRan.length = 0;
  afterCommitShouldThrow = false;
  parallelismWindows.length = 0;
  stack.events.reset();
  await stack.db.db.delete(itemTable);
  await stack.db.db.delete(auditTable);
});

describe("POST /api/batch", () => {
  test("empty commands array returns success with empty results", async () => {
    const res = await stack.http.batch([], admin);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isSuccess).toBe(true);
    expect(body.results).toEqual([]);
  });

  test("rejects non-array commands with 400", async () => {
    const res = await stack.http.raw(
      "POST",
      "/api/batch",
      // biome-ignore lint/suspicious/noExplicitAny: intentional bad body
      { commands: "not-an-array" as any },
      { Authorization: `Bearer ${await stack.jwt.sign(admin)}` },
    );
    expect(res.status).toBe(400);
  });

  test("all-succeed: writes persist, both phases fire per command", async () => {
    const res = await stack.http.batch(
      [
        { type: "batch:write:item:create", payload: { name: "alpha" } },
        { type: "batch:write:item:create", payload: { name: "beta" } },
        { type: "batch:write:item:create", payload: { name: "gamma" } },
      ],
      admin,
    );

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.isSuccess).toBe(true);
    expect(body.results).toHaveLength(3);
    for (const r of body.results) expect(r.isSuccess).toBe(true);

    // Both phases fired once per command, same ids, same order
    expect(inTxHookLog).toHaveLength(3);
    expect(afterCommitHookLog).toHaveLength(3);
    expect(inTxHookLog.map((h) => h.name)).toEqual(["alpha", "beta", "gamma"]);
    expect(afterCommitHookLog.map((h) => h.name)).toEqual(["alpha", "beta", "gamma"]);

    // Rows actually persisted
    const rows = await stack.db.db.select().from(itemTable);
    expect(rows).toHaveLength(3);
  });

  test("mid-batch failure: all writes roll back, afterCommit hooks do NOT fire", async () => {
    // Seed with one existing item so we can verify the batch didn't persist anything
    await stack.db.db.insert(itemTable).values({ name: "seed", counter: 0, tenantId: 1 });
    const seedCount = (await stack.db.db.select().from(itemTable)).length;

    const res = await stack.http.batch(
      [
        { type: "batch:write:item:create", payload: { name: "will-rollback-1" } },
        { type: "batch:write:item:fail", payload: { name: "fails" } },
        { type: "batch:write:item:create", payload: { name: "never-runs" } },
      ],
      admin,
    );

    const body = await res.json();
    // UnprocessableError → 422 (business-rule violation), which is the
    // "expected failure" HTTP status. The batch envelope keeps `failedIndex`
    // + `results` alongside the error payload so callers know which command
    // tripped the rollback.
    expect(res.status).toBe(422);
    expect(body.isSuccess).toBe(false);
    expect(body.failedIndex).toBe(1);
    expect(body.error.code).toBe("unprocessable");
    expect(body.error.details.reason).toBe("intentional_failure");

    // inTransaction hook fired for the first successful command (then rolled back
    // — but the hook log is in-memory, it persists)
    expect(inTxHookLog.map((h) => h.name)).toEqual(["will-rollback-1"]);

    // afterCommit hook must NOT have fired (transaction rolled back)
    expect(afterCommitHookLog).toEqual([]);

    // DB: only the seed row remains, the batch's first successful write rolled back
    const rows = await stack.db.db.select().from(itemTable);
    expect(rows).toHaveLength(seedCount);
    expect((rows[0] as { name: string }).name).toBe("seed");
  });

  test("inTransaction hook DB writes roll back with the batch", async () => {
    // Successful batch: audit rows should be written
    const okRes = await stack.http.batch(
      [{ type: "batch:write:item:create", payload: { name: "alpha" } }],
      admin,
    );
    expect((await okRes.json()).isSuccess).toBe(true);
    const auditAfterOk = await stack.db.db.select().from(auditTable);
    expect(auditAfterOk).toHaveLength(1);
    expect((auditAfterOk[0] as { action: string }).action).toBe("item_saved");

    // Reset — new batch fails mid-way. Both entity rows AND audit rows must roll back.
    await stack.db.db.delete(itemTable);
    await stack.db.db.delete(auditTable);

    const failRes = await stack.http.batch(
      [
        { type: "batch:write:item:create", payload: { name: "beta" } },
        { type: "batch:write:item:fail", payload: { name: "stop" } },
      ],
      admin,
    );
    expect((await failRes.json()).isSuccess).toBe(false);

    // Both tables are empty — the inTransaction audit hook's write rolled back
    // together with the item row.
    const itemsAfterFail = await stack.db.db.select().from(itemTable);
    const auditAfterFail = await stack.db.db.select().from(auditTable);
    expect(itemsAfterFail).toHaveLength(0);
    expect(auditAfterFail).toHaveLength(0);
  });

  test("afterCommit hooks run in parallel (B starts before A finishes)", async () => {
    const res = await stack.http.batch(
      [{ type: "batch:write:item:create", payload: { name: "slowness-parallel" } }],
      admin,
    );
    expect(res.status).toBe(200);

    // Extract each hook's interval independently — checks overlap of
    // intervals, not total elapsed time. Robust against CI noise.
    const aStart = parallelismWindows.find((e) => e.hook === "A" && e.start !== undefined)?.start;
    const aEnd = parallelismWindows.find((e) => e.hook === "A" && e.end !== undefined)?.end;
    const bStart = parallelismWindows.find((e) => e.hook === "B" && e.start !== undefined)?.start;
    const bEnd = parallelismWindows.find((e) => e.hook === "B" && e.end !== undefined)?.end;

    expect(aStart).toBeDefined();
    expect(aEnd).toBeDefined();
    expect(bStart).toBeDefined();
    expect(bEnd).toBeDefined();

    // Parallel iff the two intervals overlap: one starts before the other
    // ends. Sequential execution would produce disjoint intervals.
    const overlap =
      (aStart as number) < (bEnd as number) && (bStart as number) < (aEnd as number);
    expect(overlap).toBe(true);
  });

  test("afterCommit hook error is isolated: batch succeeds, other hooks still fire", async () => {
    afterCommitShouldThrow = true;

    const res = await stack.http.batch(
      [{ type: "batch:write:item:create", payload: { name: "omega" } }],
      admin,
    );

    // Batch is reported successful despite the afterCommit hook throwing
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.isSuccess).toBe(true);

    // DB row persisted (tx committed)
    const rows = await stack.db.db.select().from(itemTable);
    expect(rows).toHaveLength(1);

    // The hook AFTER the throwing one still ran — errors don't cascade
    expect(afterCommitThirdHookRan).toEqual(["omega"]);
  });

  test("idempotency: repeated batch with same requestId returns cached result, no re-exec", async () => {
    const requestId = "batch-rid-123";
    const commands = [{ type: "batch:write:item:create", payload: { name: "once" } }];

    const first = await stack.http.batch(commands, admin, requestId);
    const firstBody = await first.json();
    expect(firstBody.isSuccess).toBe(true);
    expect(firstBody.results).toHaveLength(1);

    const rowsAfterFirst = await stack.db.db.select().from(itemTable);
    expect(rowsAfterFirst).toHaveLength(1);

    // Hook logs reflect one execution
    expect(inTxHookLog).toHaveLength(1);
    expect(afterCommitHookLog).toHaveLength(1);

    // Retry with the same requestId — same response, but commands did NOT run again
    const second = await stack.http.batch(commands, admin, requestId);
    const secondBody = await second.json();

    expect(secondBody.isSuccess).toBe(true);
    expect(secondBody.results).toEqual(firstBody.results);

    // DB still has only one row (no double-insert)
    const rowsAfterSecond = await stack.db.db.select().from(itemTable);
    expect(rowsAfterSecond).toHaveLength(1);

    // Hooks didn't fire a second time
    expect(inTxHookLog).toHaveLength(1);
    expect(afterCommitHookLog).toHaveLength(1);
  });
});

describe("POST /api/write (single write runs in its own transaction)", () => {
  test("inTransaction hook DB write persists with the entity write", async () => {
    const res = await stack.http.write("batch:write:item:create", { name: "single" }, admin);
    const body = await res.json();
    expect(body.isSuccess).toBe(true);

    // Both the item row AND the audit row exist — proves the single write
    // went through a transaction and the inTx hook shared it.
    const items = await stack.db.db.select().from(itemTable);
    const audits = await stack.db.db.select().from(auditTable);
    expect(items).toHaveLength(1);
    expect(audits).toHaveLength(1);
  });

  test("handler throw rolls back inTransaction hook writes too", async () => {
    // First a successful write so there's something to compare against
    await stack.http.write("batch:write:item:create", { name: "survivor" }, admin);
    const beforeItems = await stack.db.db.select().from(itemTable);
    const beforeAudits = await stack.db.db.select().from(auditTable);
    expect(beforeItems).toHaveLength(1);
    expect(beforeAudits).toHaveLength(1);

    // Now a write whose handler throws — nothing new should be committed
    const res = await stack.http.write("batch:write:item:throw", { name: "crash" }, admin);
    const body = await res.json();
    expect(body.isSuccess).toBe(false);

    const afterItems = await stack.db.db.select().from(itemTable);
    const afterAudits = await stack.db.db.select().from(auditTable);
    // Counts unchanged — no partial commit
    expect(afterItems).toHaveLength(beforeItems.length);
    expect(afterAudits).toHaveLength(beforeAudits.length);
  });
});

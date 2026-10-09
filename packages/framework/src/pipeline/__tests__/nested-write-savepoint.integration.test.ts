import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor.js";
import { asRawClient, selectMany } from "../../db/query.js";
import { buildEntityTable } from "../../db/table-builder.js";
import {
  createEntity,
  createTextField,
  defineFeature,
  HookPhases,
  type WriteResult,
} from "../../engine/index.js";
import type { HandlerContext } from "../../engine/types/index.js";
import { eventsTable } from "../../event-store/index.js";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack/index.js";

// A nested ctx.write runs inside the outer handler's transaction. When it fails
// after its event and projection are written (inTransaction hook throws, SQL
// error), the outer handler may swallow the failure result and commit — the
// inner write must still be undone, and the outer tx must stay usable.

const outerEntity = createEntity({
  table: "nws_outers",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const outerTable = buildEntityTable("outer", outerEntity);

const innerEntity = createEntity({
  table: "nws_inners",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const innerTable = buildEntityTable("inner", innerEntity);

const innerCrud = createEventStoreExecutor(innerTable, innerEntity, { entityName: "inner" });

const midEntity = createEntity({
  table: "nws_mids",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const midTable = buildEntityTable("mid", midEntity);
const midCrud = createEventStoreExecutor(midTable, midEntity, { entityName: "mid" });

// Inner hook rejects any label carrying this marker; tests isolate themselves by unique label prefixes.
const REJECTED_MARKER = "rejected";

let stack: TestStack;
const admin = TestUsers.admin;

const afterCommitLog: string[] = [];
let lastInnerResult: WriteResult | undefined;
let lastHookWriteResult: WriteResult | undefined;

const nestedFeature = defineFeature("nws", (r) => {
  const inner = r.entity("inner", innerEntity);
  const mid = r.entity("mid", midEntity);
  r.entity("outer", outerEntity);

  r.writeHandler(
    "inner:create",
    z.object({ label: z.string() }),
    async (event, ctx) => innerCrud.create(event.payload, event.user, ctx.db),
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "mid:create",
    z.object({ label: z.string() }),
    async (event, ctx) => midCrud.create(event.payload, event.user, ctx.db),
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "inner:create-then-sql-error",
    z.object({ label: z.string() }),
    async (event, ctx) => {
      await innerCrud.create(event.payload, event.user, ctx.db);
      await asRawClient(ctx.db.unsafeRaw()).unsafe("SELECT 1 FROM nws_no_such_table");
      return { isSuccess: true as const, data: {} };
    },
    {
      access: { roles: ["Admin"] },
      escapeHatch: { reason: "test fixture: provoke a SQL error inside a nested write" },
    },
  );

  r.writeHandler(
    "outer:create",
    z.object({ label: z.string(), innerHandler: z.string(), innerLabel: z.string() }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(outerTable, outerEntity, { entityName: "outer" });
      const created = await crud.create({ label: event.payload.label }, event.user, ctx.db);
      if (!created.isSuccess) return created;

      lastInnerResult = await ctx.write(`nws:write:${event.payload.innerHandler}`, {
        label: event.payload.innerLabel,
      });

      return crud.create({ label: `${event.payload.label}-after` }, event.user, ctx.db);
    },
    { access: { roles: ["Admin"] } },
  );

  r.hook(
    "postSave",
    { allOf: inner },
    async (result) => {
      if (String(result.data["label"]).includes(REJECTED_MARKER)) {
        throw new Error("inner write rejected");
      }
    },
    { phase: HookPhases.inTransaction },
  );

  // Second nesting level: mid's in-transaction hook writes an inner row and swallows its failure.
  r.hook(
    "postSave",
    { allOf: mid },
    async (result, ctx) => {
      // Hooks are typed against AppContext; the runtime object is the full HandlerContext. @cast-boundary
      const handlerCtx = ctx as unknown as HandlerContext;
      lastHookWriteResult = await handlerCtx.write("nws:write:inner:create", {
        label: `${result.data["label"]}-${REJECTED_MARKER}`,
      });
    },
    { phase: HookPhases.inTransaction },
  );

  r.hook("postSave", { allOf: mid }, async (result) => {
    afterCommitLog.push(`mid:${result.data["label"]}`);
  });

  r.hook("postSave", { allOf: inner }, async (result) => {
    afterCommitLog.push(`inner:${result.data["label"]}`);
  });
});

async function eventsMentioning(marker: string) {
  const rows = await selectMany(stack.db, eventsTable);
  return (rows as Array<Record<string, unknown>>).filter((row) =>
    JSON.stringify(row["payload"]).includes(marker),
  );
}

async function labelsOf(
  table: typeof outerTable | typeof innerTable | typeof midTable,
  prefix: string,
): Promise<string[]> {
  const rows = await selectMany(stack.db, table);
  return (rows as Array<Record<string, unknown>>)
    .map((row) => String(row["label"]))
    .filter((label) => label.startsWith(prefix))
    .sort();
}

beforeAll(async () => {
  stack = await setupTestStack({ features: [nestedFeature] });
  await unsafeCreateEntityTable(stack.db, outerEntity);
  await unsafeCreateEntityTable(stack.db, innerEntity);
  await unsafeCreateEntityTable(stack.db, midEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  afterCommitLog.length = 0;
  lastInnerResult = undefined;
  lastHookWriteResult = undefined;
  await stack.redis.flushNamespace();
});

describe("nested ctx.write failure is confined to a savepoint", () => {
  test("a throwing inTransaction hook undoes the inner event and projection, outer commits", async () => {
    const res = await stack.http.write(
      "nws:write:outer:create",
      { label: "t1-outer", innerHandler: "inner:create", innerLabel: "t1-rejected" },
      admin,
    );
    expect((await res.json()).isSuccess).toBe(true);

    expect(lastInnerResult?.isSuccess).toBe(false);
    expect(await labelsOf(innerTable, "t1-")).toEqual([]);
    expect(await eventsMentioning("t1-rejected")).toHaveLength(0);
    expect(await labelsOf(outerTable, "t1-outer")).toEqual(["t1-outer", "t1-outer-after"]);
    expect(afterCommitLog).toEqual([]);
  });

  test("a SQL error in the inner write does not poison the outer transaction", async () => {
    const res = await stack.http.write(
      "nws:write:outer:create",
      {
        label: "t2-outer",
        innerHandler: "inner:create-then-sql-error",
        innerLabel: "t2-sql-victim",
      },
      admin,
    );
    expect((await res.json()).isSuccess).toBe(true);

    expect(lastInnerResult?.isSuccess).toBe(false);
    expect(await labelsOf(innerTable, "t2-")).toEqual([]);
    expect(await eventsMentioning("t2-sql-victim")).toHaveLength(0);
    expect(await labelsOf(outerTable, "t2-outer")).toEqual(["t2-outer", "t2-outer-after"]);
    expect(afterCommitLog).toEqual([]);
  });

  test("a successful inner write is committed and its afterCommit hook runs exactly once", async () => {
    const res = await stack.http.write(
      "nws:write:outer:create",
      { label: "t3-outer", innerHandler: "inner:create", innerLabel: "t3-kept" },
      admin,
    );
    expect((await res.json()).isSuccess).toBe(true);

    expect(lastInnerResult?.isSuccess).toBe(true);
    expect(await labelsOf(innerTable, "t3-")).toEqual(["t3-kept"]);
    expect(await eventsMentioning("t3-kept")).toHaveLength(1);
    expect(afterCommitLog).toEqual(["inner:t3-kept"]);
  });

  test("a failed write nested two levels deep is undone while the middle write and outer commit", async () => {
    const res = await stack.http.write(
      "nws:write:outer:create",
      { label: "t4-outer", innerHandler: "mid:create", innerLabel: "t4-mid" },
      admin,
    );
    expect((await res.json()).isSuccess).toBe(true);

    expect(lastInnerResult?.isSuccess).toBe(true);
    expect(lastHookWriteResult?.isSuccess).toBe(false);
    expect(await labelsOf(innerTable, "t4-")).toEqual([]);
    expect(await eventsMentioning("t4-mid-rejected")).toHaveLength(0);
    expect(await labelsOf(midTable, "t4-")).toEqual(["t4-mid"]);
    expect(await eventsMentioning("t4-mid")).toHaveLength(1);
    expect(await labelsOf(outerTable, "t4-outer")).toEqual(["t4-outer", "t4-outer-after"]);
    expect(afterCommitLog).toEqual(["mid:t4-mid"]);
  });
});

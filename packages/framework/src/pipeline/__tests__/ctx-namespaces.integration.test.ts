// The namespaced handler context over real HTTP: events, dispatch, auth, obs and
// db.outsideTransaction on one write handler, plus the flat log a postSave hook still reads.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { selectMany } from "../../db/query.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import { hasOutsideTransactionDb, requireOutsideTransactionDb } from "../../db/tenant-db.ts";
import { runInOwnTransaction } from "../../db/tenant-db-scoped-rebind.ts";
import { createEntity, createTextField, defineFeature } from "../../engine/index.ts";
import { eventsTable, loadAggregate } from "../../event-store/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const noteEntity = createEntity({
  table: "ctx_ns_notes",
  fields: { title: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});
const noteTable = buildEntityTable("note", noteEntity);
const noteExecutor = createEventStoreExecutor(noteTable, noteEntity, { entityName: "note" });

const FEATURE = "ctxns";
const hookLogShapes: { readonly isLogger: boolean }[] = [];

const nsFeature = defineFeature(FEATURE, (r) => {
  const note = r.entity({ name: "note", ...noteEntity });
  const pinged = r.defineEvent("pinged", z.object({ n: z.number() }), { piiFields: "none" });

  r.writeHandler({
    name: "inner-create",
    schema: z.object({ title: z.string() }),
    handler: async (event, ctx) => noteExecutor.create(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });

  r.queryHandler({
    name: "echo",
    schema: z.object({ value: z.string() }),
    handler: async (query) => ({ echo: query.payload.value }),
    access: { roles: ["Admin"] },
  });

  r.writeHandler({
    name: "all-namespaces",
    schema: z.object({ value: z.string() }),
    handler: async (event, ctx) => {
      const created = await noteExecutor.create({ title: "outer" }, ctx.user, ctx.db);
      if (!created.isSuccess) return created;

      await ctx.events.unsafeAppend({
        aggregateId: String(created.data["id"]),
        aggregateType: "note",
        type: pinged.name,
        payload: { n: 1 },
      });

      const inner = await ctx.dispatch.write(`${FEATURE}:write:inner-create`, { title: "inner" });
      const echoed = await ctx.dispatch.query(`${FEATURE}:query:echo`, {
        value: event.payload.value,
      });
      const claims = await ctx.auth.resolveClaims(ctx.user);

      ctx.obs.log.info("ctx namespaces probe", { value: event.payload.value });
      const outsideRows = await runInOwnTransaction(requireOutsideTransactionDb(ctx), (txDb) =>
        selectMany(txDb, noteTable, {}),
      );

      return {
        isSuccess: true as const,
        data: {
          innerOk: inner.isSuccess,
          echoed,
          claimKeys: Object.keys(claims),
          logHasChild: typeof ctx.obs.log.child === "function",
          metricsHasInc: typeof ctx.obs.metrics.inc === "function",
          tracerPresent: ctx.obs.tracer !== undefined,
          hasOutsideHandle: hasOutsideTransactionDb(ctx),
          outsideRowsBeforeCommit: outsideRows.length,
        },
      };
    },
    access: { roles: ["Admin"] },
  });

  r.hook({
    type: "postSave",
    target: { allOf: note },
    handler: async (_result, context) => {
      const log = context.log;
      log?.info("postSave hook reads the flat context log");
      hookLogShapes.push({ isLogger: typeof log?.child === "function" });
    },
  });
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [nsFeature] });
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [noteTable, eventsTable]);
  hookLogShapes.length = 0;
});

describe("namespaced handler context", () => {
  test("events, dispatch, auth, obs and db.outsideTransaction work on one write handler", async () => {
    const data = await stack.http.writeOk<{
      innerOk: boolean;
      echoed: { echo: string };
      claimKeys: string[];
      logHasChild: boolean;
      metricsHasInc: boolean;
      tracerPresent: boolean;
      hasOutsideHandle: boolean;
      outsideRowsBeforeCommit: number;
    }>(`${FEATURE}:write:all-namespaces`, { value: "ping" }, admin);

    expect(data.innerOk).toBe(true);
    expect(data.echoed).toEqual({ echo: "ping" });
    expect(data.claimKeys).toEqual([]);
    expect(data.logHasChild).toBe(true);
    expect(data.metricsHasInc).toBe(true);
    expect(data.tracerPresent).toBe(true);
    expect(data.hasOutsideHandle).toBe(true);
    // The outside-transaction db is not bound to the handler's tx: the rows written in it are invisible.
    expect(data.outsideRowsBeforeCommit).toBe(0);

    const titles = (await selectMany<{ title: string }>(stack.db, noteTable, {}))
      .map((row) => row.title)
      .sort();
    expect(titles).toEqual(["inner", "outer"]);
  });

  test("events.unsafeAppend lands the event on the aggregate stream of the created row", async () => {
    await stack.http.writeOk(`${FEATURE}:write:all-namespaces`, { value: "stream" }, admin);

    const [outer] = await selectMany<{ id: string; title: string }>(stack.db, noteTable, {
      title: "outer",
    });
    expect(outer).toBeDefined();
    const events = await loadAggregate(stack.db, String(outer?.id), admin.tenantId);
    expect(events.map((event) => event.type)).toEqual(["note.created", `${FEATURE}:event:pinged`]);
  });

  test("a postSave hook reads a Logger from the flat context.log", async () => {
    await stack.http.writeOk(`${FEATURE}:write:inner-create`, { title: "hooked" }, admin);

    expect(hookLogShapes).toEqual([{ isLogger: true }]);
  });
});

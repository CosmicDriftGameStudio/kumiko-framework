// beforeTransaction over real HTTP: the phase runs after the gates and before the transaction, its
// data reaches the handler as event.prepared, and its release runs whenever the transaction does
// not commit.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as z from "zod";
import { selectMany } from "../../bun-db/index.js";
import { createEventStoreExecutor } from "../../db/event-store-executor.js";
import { buildEntityTable } from "../../db/table-builder.js";
import {
  createEntity,
  createTextField,
  defineFeature,
  defineWriteHandler,
} from "../../engine/index.js";
import { UnprocessableError, writeFailure } from "../../errors/index.js";
import { eventsTable } from "../../event-store/index.js";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "../../stack/index.js";
import { resetTestTables } from "../../testing/index.js";

const noteEntity = createEntity({
  table: "before_tx_notes",
  fields: { title: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});
const noteTable = buildEntityTable("note", noteEntity);
const noteExecutor = createEventStoreExecutor(noteTable, noteEntity, { entityName: "note" });

const FEATURE = "before-tx";
const PREPARE_OK = `${FEATURE}:write:prepare-ok`;
const PREPARE_REJECTED = `${FEATURE}:write:prepare-rejected`;
const PREPARE_GUARDED = `${FEATURE}:write:prepare-guarded`;
const PREPARE_WRITES = `${FEATURE}:write:prepare-writes`;
const RESERVE_WRITES = `${FEATURE}:write:reserve-writes`;
const RESERVE_APPENDS = `${FEATURE}:write:reserve-appends`;
const RESERVE_OUTSIDE = `${FEATURE}:write:reserve-outside`;
const NESTED_OUTER = `${FEATURE}:write:nested-outer`;
const PREPARE_FOR_TENANT = `${FEATURE}:write:prepare-for-tenant`;

const beforeCalls: string[] = [];
const handlerCalls: string[] = [];
const releaseCalls: string[] = [];
const reservationOutsideHandles: boolean[] = [];
const reservationOutsideReads: number[] = [];

const titlePayload = z.object({ title: z.string(), failInHandler: z.boolean().optional() });
const forTenantPayload = z.object({ targetTenant: z.number(), write: z.boolean() });

const beforeTxFeature = defineFeature(FEATURE, (r) => {
  r.entity("note", noteEntity);

  r.writeHandler(
    defineWriteHandler({
      name: "plain-create",
      schema: titlePayload,
      access: { roles: ["Admin"] },
      handler: async (event, ctx) => {
        const created = await noteExecutor.create({ title: event.payload.title }, ctx.user, ctx.db);
        return created.isSuccess ? { isSuccess: true as const, data: {} } : created;
      },
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "prepare-ok",
      schema: titlePayload,
      access: { roles: ["Admin"] },
      beforeTransaction: async (event) => {
        beforeCalls.push(event.payload.title);
        return {
          isSuccess: true as const,
          data: { token: `prepared-${event.payload.title}` },
          release: async () => {
            releaseCalls.push(event.payload.title);
          },
        };
      },
      handler: async (event, ctx) => {
        handlerCalls.push(event.prepared.token);
        const created = await noteExecutor.create(
          { title: event.prepared.token },
          ctx.user,
          ctx.db,
        );
        if (!created.isSuccess) return created;
        if (event.payload.failInHandler) {
          return writeFailure(new UnprocessableError("handler_rejected"));
        }
        return { isSuccess: true as const, data: { token: event.prepared.token } };
      },
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "prepare-for-tenant",
      schema: forTenantPayload,
      access: { roles: ["Admin", "SystemAdmin"] },
      beforeTransaction: async (event, ctx) => {
        const target = ctx.forTenant?.(testTenantId(event.payload.targetTenant));
        if (!target) throw new Error("forTenant is expected in the beforeTransaction phase");
        if (event.payload.write) {
          await noteExecutor.create({ title: "from-phase" }, ctx.user, target.db);
        }
        const rows = await selectMany<{ title: string }>(target.db, noteTable, {});
        return { isSuccess: true as const, data: { titles: rows.map((row) => row.title) } };
      },
      handler: async (event) => ({ isSuccess: true as const, data: event.prepared }),
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "prepare-rejected",
      schema: titlePayload,
      access: { roles: ["Admin"] },
      beforeTransaction: async () => writeFailure(new UnprocessableError("prepare_rejected")),
      handler: async () => {
        handlerCalls.push("prepare-rejected");
        return { isSuccess: true as const, data: {} };
      },
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "prepare-guarded",
      schema: titlePayload,
      access: { roles: ["Admin"] },
      beforeTransaction: async (event) => {
        beforeCalls.push(event.payload.title);
        return { isSuccess: true as const, data: undefined };
      },
      handler: async () => ({ isSuccess: true as const, data: {} }),
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "prepare-writes",
      schema: titlePayload,
      access: { roles: ["Admin"] },
      beforeTransaction: async (event, ctx) => {
        await ctx.write(`${FEATURE}:write:plain-create`, { title: event.payload.title });
        return { isSuccess: true as const, data: undefined };
      },
      handler: async () => {
        handlerCalls.push("prepare-writes");
        return { isSuccess: true as const, data: {} };
      },
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "reserve-writes",
      schema: titlePayload,
      access: { roles: ["Admin"] },
      reserveBeforeTransaction: async (_event, ctx) => {
        await ctx.write(`${FEATURE}:write:plain-create`, { title: "sneaky" });
        return undefined;
      },
      handler: async () => {
        handlerCalls.push("reserve-writes");
        return { isSuccess: true as const, data: {} };
      },
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "reserve-appends",
      schema: titlePayload,
      access: { roles: ["Admin"] },
      reserveBeforeTransaction: async (_event, ctx) => {
        await ctx.unsafeAppendEvent({
          aggregateId: "00000000-0000-4000-8000-000000000001",
          aggregateType: "note",
          type: "note.created",
          payload: { title: "sneaky" },
        });
        return undefined;
      },
      handler: async () => {
        handlerCalls.push("reserve-appends");
        return { isSuccess: true as const, data: {} };
      },
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "reserve-outside",
      schema: titlePayload,
      access: { roles: ["Admin"] },
      reserveBeforeTransaction: async (_event, ctx) => {
        reservationOutsideHandles.push(
          ctx.dbOutsideTransaction !== undefined,
          ctx.outsideTransaction !== undefined,
        );
        const rows = await ctx.outsideTransaction?.((txDb) =>
          selectMany<{ title: string }>(txDb, noteTable, {}),
        );
        reservationOutsideReads.push(rows?.length ?? -1);
        return undefined;
      },
      handler: async () => {
        handlerCalls.push("reserve-outside");
        return { isSuccess: true as const, data: {} };
      },
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "nested-outer",
      schema: titlePayload,
      access: { roles: ["Admin"] },
      handler: async (event, ctx) => {
        const created = await noteExecutor.create({ title: event.payload.title }, ctx.user, ctx.db);
        if (!created.isSuccess) return created;
        return ctx.write(PREPARE_OK, { title: event.payload.title });
      },
    }),
  );
});

let stack: TestStack;
const admin = createTestUser({ id: 1, tenantId: testTenantId(9501), roles: ["Admin"] });
const viewer = createTestUser({ id: 2, tenantId: testTenantId(9501), roles: ["Viewer"] });
const systemAdmin = createTestUser({
  id: 3,
  tenantId: testTenantId(9501),
  roles: ["SystemAdmin"],
});
const foreignAdmin = createTestUser({ id: 4, tenantId: testTenantId(9502), roles: ["Admin"] });
const FOREIGN_TENANT = 9502;

beforeAll(async () => {
  stack = await setupTestStack({ features: [beforeTxFeature] });
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [noteTable, eventsTable]);
  beforeCalls.length = 0;
  handlerCalls.length = 0;
  releaseCalls.length = 0;
  reservationOutsideHandles.length = 0;
  reservationOutsideReads.length = 0;
});

async function noteTitles(): Promise<string[]> {
  const rows = await selectMany<{ title: string }>(stack.db, noteTable, {});
  return rows.map((row) => row.title);
}

describe("beforeTransaction", () => {
  test("the prepared value reaches the handler, the write commits and nothing is released", async () => {
    const data = await stack.http.writeOk<{ token: string }>(PREPARE_OK, { title: "a" }, admin);

    expect(data.token).toBe("prepared-a");
    expect(beforeCalls).toEqual(["a"]);
    expect(handlerCalls).toEqual(["prepared-a"]);
    expect(await noteTitles()).toEqual(["prepared-a"]);
    expect(releaseCalls).toEqual([]);
  });

  test("a failure result rejects the write: handler never runs, nothing is written", async () => {
    const error = await stack.http.writeErr(PREPARE_REJECTED, { title: "x" }, admin);

    expect(error.details).toEqual({ reason: "prepare_rejected" });
    expect(handlerCalls).toEqual([]);
    expect(await noteTitles()).toEqual([]);
  });

  test("a caller without access never reaches the phase", async () => {
    const error = await stack.http.writeErr(PREPARE_GUARDED, { title: "denied" }, viewer);

    expect(error.httpStatus).toBe(403);
    expect(beforeCalls).toEqual([]);
  });

  test("a handler failure after the phase releases once and writes nothing", async () => {
    const error = await stack.http.writeErr(PREPARE_OK, { title: "b", failInHandler: true }, admin);

    expect(error.details).toEqual({ reason: "handler_rejected" });
    expect(releaseCalls).toEqual(["b"]);
    expect(await noteTitles()).toEqual([]);
  });

  test("a failing second command of a batch releases the first command's phase and writes nothing", async () => {
    const res = await stack.http.batch(
      [
        { type: PREPARE_OK, payload: { title: "first" } },
        { type: PREPARE_OK, payload: { title: "second", failInHandler: true } },
      ],
      admin,
    );

    expect(res.ok).toBe(false);
    expect(releaseCalls).toEqual(["second", "first"]);
    expect(await noteTitles()).toEqual([]);
  });

  test("a nested ctx.write to a handler with the phase is rejected and rolls the outer write back", async () => {
    const error = await stack.http.writeErr(NESTED_OUTER, { title: "nested" }, admin);

    expect(error.httpStatus).toBe(500);
    expect(error.message).toContain("has a pre-transaction phase");
    expect(beforeCalls).toEqual([]);
    expect(await noteTitles()).toEqual([]);
  });

  test("ctx.write inside the phase throws and rejects the write", async () => {
    const error = await stack.http.writeErr(PREPARE_WRITES, { title: "sneaky" }, admin);

    expect(error.httpStatus).toBe(500);
    expect(error.message).toContain("ctx.write is not available before the transaction");
    expect(handlerCalls).toEqual([]);
    expect(await noteTitles()).toEqual([]);
  });

  test("a SystemAdmin reads a foreign tenant's rows through forTenant in the phase", async () => {
    await stack.http.writeOk(
      "before-tx:write:plain-create",
      { title: "foreign-row" },
      foreignAdmin,
    );

    const data = await stack.http.writeOk<{ titles: string[] }>(
      PREPARE_FOR_TENANT,
      { targetTenant: FOREIGN_TENANT, write: false },
      systemAdmin,
    );

    expect(data.titles).toEqual(["foreign-row"]);
  });

  test("a write through the phase's forTenant db throws and persists nothing", async () => {
    const error = await stack.http.writeErr(
      PREPARE_FOR_TENANT,
      { targetTenant: FOREIGN_TENANT, write: true },
      systemAdmin,
    );

    expect(error.httpStatus).toBe(500);
    expect(error.message).toContain("without an open transaction");
    expect(await noteTitles()).toEqual([]);
  });

  test("a write through the phase's forTenant db on the own tenant throws too", async () => {
    const error = await stack.http.writeErr(
      PREPARE_FOR_TENANT,
      { targetTenant: 9501, write: true },
      admin,
    );

    expect(error.message).toContain("without an open transaction");
    expect(await noteTitles()).toEqual([]);
  });

  test("a non-SystemAdmin cannot reach a foreign tenant through forTenant in the phase", async () => {
    const error = await stack.http.writeErr(
      PREPARE_FOR_TENANT,
      { targetTenant: FOREIGN_TENANT, write: true },
      admin,
    );

    expect(error.httpStatus).toBe(403);
    expect(await noteTitles()).toEqual([]);
  });

  test("ctx.write inside a reservation throws before either handler runs", async () => {
    const error = await stack.http.writeErr(RESERVE_WRITES, { title: "sneaky" }, admin);

    expect(error.httpStatus).toBe(500);
    expect(error.message).toContain("ctx.write is not available before the transaction");
    expect(handlerCalls).toEqual([]);
    expect(await noteTitles()).toEqual([]);
  });

  test("ctx.unsafeAppendEvent inside a reservation throws and persists no event", async () => {
    const error = await stack.http.writeErr(RESERVE_APPENDS, { title: "sneaky" }, admin);

    expect(error.httpStatus).toBe(500);
    expect(error.message).toContain(
      "ctx.unsafeAppendEvent is not available before the transaction",
    );
    expect(handlerCalls).toEqual([]);
    expect(await selectMany(stack.db, eventsTable, {})).toEqual([]);
  });

  test("a reservation keeps the outside-transaction handles and can read through them", async () => {
    await stack.http.writeOk(RESERVE_OUTSIDE, { title: "ok" }, admin);

    expect(reservationOutsideHandles).toEqual([true, true]);
    expect(reservationOutsideReads).toEqual([0]);
    expect(handlerCalls).toEqual(["reserve-outside"]);
  });
});

// beforeTransaction over real HTTP: the phase runs after the gates and before the transaction, its
// data reaches the handler as event.prepared, and its release runs whenever the transaction does
// not commit.

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
import {
  createEntity,
  createTextField,
  defineFeature,
  defineWriteHandler,
} from "../../engine/index.ts";
import type { NotifyFactory } from "../../engine/types/index.ts";
import { UnprocessableError, writeFailure } from "../../errors/index.ts";
import { eventsTable } from "../../event-store/index.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";
import { generateId } from "../../utils/index.ts";

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
const RESERVE_OUTSIDE_WRITES = `${FEATURE}:write:reserve-outside-writes`;
const RESERVE_DENIED = `${FEATURE}:write:reserve-denied`;
const PREPARE_GENERATED = `${FEATURE}:write:prepare-generated`;
const NESTED_OUTER = `${FEATURE}:write:nested-outer`;
const PREPARE_FOR_TENANT = `${FEATURE}:write:prepare-for-tenant`;

const beforeCalls: string[] = [];
const generatedIds: { readonly phase: string; readonly handler: string }[] = [];
const handlerCalls: string[] = [];

// The phase contexts no longer type these surfaces; the runtime still has to deny them, so the
// probes reach them by path instead of through the type.
async function callAbsentSurface(
  ctx: object,
  path: readonly [string, ...string[]],
  ...args: readonly unknown[]
): Promise<void> {
  let owner: unknown = ctx;
  let surface: unknown = ctx;
  for (const key of path) {
    if (typeof surface !== "object" && typeof surface !== "function") break;
    if (surface === null) break;
    owner = surface;
    surface = Reflect.get(surface, key);
  }
  if (typeof surface !== "function") {
    throw new Error(`ctx.${path.join(".")} is not a function on this context`);
  }
  await surface.apply(owner, args);
}
const releaseCalls: string[] = [];
const reservationOutsideHandles: boolean[] = [];
const reservationOutsideReads: number[] = [];

const DENIED_SURFACES = [
  "writeAs",
  "scheduleAfterCommit",
  "scheduleAfterRollback",
  "notify",
  "jobRunner",
] as const;
// The denial names the namespaced path of the surface the handler reached for.
const SURFACE_PATHS: Record<(typeof DENIED_SURFACES)[number], string> = {
  writeAs: "dispatch.writeAs",
  scheduleAfterCommit: "scheduleAfterCommit",
  scheduleAfterRollback: "scheduleAfterRollback",
  notify: "notify",
  jobRunner: "jobRunner",
};
const deniedSurfacePayload = z.object({ surface: z.enum(DENIED_SURFACES) });

const notifyFactory: NotifyFactory = () => async () => ({ kind: "dispatched", deliveries: [] });

const titlePayload = z.object({ title: z.string(), failInHandler: z.boolean().optional() });
const forTenantPayload = z.object({ targetTenant: z.number(), write: z.boolean() });

const beforeTxFeature = defineFeature(FEATURE, (r) => {
  r.entity({ name: "note", ...noteEntity });

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
        await callAbsentSurface(ctx, ["dispatch", "write"], `${FEATURE}:write:plain-create`, {
          title: event.payload.title,
        });
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
        await callAbsentSurface(ctx, ["dispatch", "write"], `${FEATURE}:write:plain-create`, {
          title: "sneaky",
        });
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
        await callAbsentSurface(ctx, ["events", "unsafeAppend"], {
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
        reservationOutsideHandles.push(hasOutsideTransactionDb(ctx));
        const rows = await runInOwnTransaction(requireOutsideTransactionDb(ctx), (txDb) =>
          selectMany<{ title: string }>(txDb, noteTable, {}),
        );
        reservationOutsideReads.push(rows.length);
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
      name: "reserve-outside-writes",
      schema: titlePayload,
      access: { roles: ["Admin"] },
      reserveBeforeTransaction: async (event, ctx) => {
        await runInOwnTransaction(requireOutsideTransactionDb(ctx), (txDb) =>
          noteExecutor.create({ title: "reserved" }, event.user, txDb),
        );
        return undefined;
      },
      handler: async (event) => {
        handlerCalls.push("reserve-outside-writes");
        if (event.payload.failInHandler) {
          return writeFailure(new UnprocessableError("handler_rejected"));
        }
        return { isSuccess: true as const, data: {} };
      },
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "reserve-denied",
      schema: deniedSurfacePayload,
      access: { roles: ["Admin"] },
      reserveBeforeTransaction: async (event, ctx) => {
        switch (deniedSurfacePayload.parse(event.payload).surface) {
          case "writeAs":
            await callAbsentSurface(
              ctx,
              ["dispatch", "writeAs"],
              event.user,
              `${FEATURE}:write:plain-create`,
              {
                title: "sneaky",
              },
            );
            break;
          case "scheduleAfterCommit":
            await callAbsentSurface(ctx, ["scheduleAfterCommit"], async () => {});
            break;
          case "scheduleAfterRollback":
            await callAbsentSurface(ctx, ["scheduleAfterRollback"], async () => {});
            break;
          case "notify":
            await callAbsentSurface(ctx, ["notify"], "before-tx-probe", {
              route: { email: "probe@example.com" },
            });
            break;
          case "jobRunner":
            await ctx.jobRunner?.dispatch?.(`${FEATURE}:job:probe`, {});
            break;
        }
        return undefined;
      },
      handler: async () => {
        handlerCalls.push("reserve-denied");
        return { isSuccess: true as const, data: {} };
      },
    }),
  );

  r.job("probe", { trigger: { manual: true }, retries: 0 }, async () => {});

  r.writeHandler(
    defineWriteHandler({
      name: "prepare-generated",
      schema: z.object({ id: z.string().default(() => generateId()) }),
      access: { roles: ["Admin"] },
      beforeTransaction: async (event) => ({
        isSuccess: true as const,
        data: { phaseId: event.payload.id },
      }),
      handler: async (event) => {
        generatedIds.push({ phase: event.prepared.phaseId, handler: event.payload.id });
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
        return ctx.dispatch.write(PREPARE_OK, { title: event.payload.title });
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
  stack = await setupTestStack({
    features: [beforeTxFeature],
    extraContext: { _notifyFactory: notifyFactory },
    jobs: {},
  });
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [noteTable, eventsTable]);
  beforeCalls.length = 0;
  generatedIds.length = 0;
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

  test("a value the schema generates while parsing is the same in the phase and the handler", async () => {
    await stack.http.writeOk(PREPARE_GENERATED, {}, admin);

    expect(generatedIds).toHaveLength(1);
    expect(generatedIds[0]?.handler).toBe(generatedIds[0]?.phase);
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

  test("a nested ctx.dispatch.write to a handler with the phase is rejected and rolls the outer write back", async () => {
    const error = await stack.http.writeErr(NESTED_OUTER, { title: "nested" }, admin);

    expect(error.httpStatus).toBe(500);
    expect(error.message).toContain("has a pre-transaction phase");
    expect(beforeCalls).toEqual([]);
    expect(await noteTitles()).toEqual([]);
  });

  test("ctx.dispatch.write inside the phase throws and rejects the write", async () => {
    const error = await stack.http.writeErr(PREPARE_WRITES, { title: "sneaky" }, admin);

    expect(error.httpStatus).toBe(500);
    expect(error.message).toContain("ctx.dispatch.write is not available before the transaction");
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

  test("ctx.dispatch.write inside a reservation throws before either handler runs", async () => {
    const error = await stack.http.writeErr(RESERVE_WRITES, { title: "sneaky" }, admin);

    expect(error.httpStatus).toBe(500);
    expect(error.message).toContain("ctx.dispatch.write is not available before the transaction");
    expect(handlerCalls).toEqual([]);
    expect(await noteTitles()).toEqual([]);
  });

  test("ctx.events.unsafeAppend inside a reservation throws and persists no event", async () => {
    const error = await stack.http.writeErr(RESERVE_APPENDS, { title: "sneaky" }, admin);

    expect(error.httpStatus).toBe(500);
    expect(error.message).toContain(
      "ctx.events.unsafeAppend is not available before the transaction",
    );
    expect(handlerCalls).toEqual([]);
    expect(await selectMany(stack.db, eventsTable, {})).toEqual([]);
  });

  test.each([...DENIED_SURFACES])(
    "ctx.%s inside a reservation throws before the handler runs",
    async (surface) => {
      const error = await stack.http.writeErr(RESERVE_DENIED, { surface }, admin);

      expect(error.httpStatus).toBe(500);
      expect(error.message).toContain(
        `ctx.${SURFACE_PATHS[surface]} is not available before the transaction`,
      );
      expect(handlerCalls).toEqual([]);
    },
  );

  test("a reservation write through the outside-transaction db commits with the request", async () => {
    await stack.http.writeOk(RESERVE_OUTSIDE_WRITES, { title: "ok" }, admin);

    expect(await noteTitles()).toEqual(["reserved"]);
    expect(handlerCalls).toEqual(["reserve-outside-writes"]);
  });

  test("a reservation write through the outside-transaction db survives a failing handler", async () => {
    const error = await stack.http.writeErr(
      RESERVE_OUTSIDE_WRITES,
      { title: "bad", failInHandler: true },
      admin,
    );

    expect(error.httpStatus).toBe(422);
    expect(handlerCalls).toEqual(["reserve-outside-writes"]);
    expect(await noteTitles()).toEqual(["reserved"]);
  });

  test("a reservation keeps the outside-transaction handles and can read through them", async () => {
    await stack.http.writeOk(RESERVE_OUTSIDE, { title: "ok" }, admin);

    expect(reservationOutsideHandles).toEqual([true]);
    expect(reservationOutsideReads).toEqual([0]);
    expect(handlerCalls).toEqual(["reserve-outside"]);
  });
});

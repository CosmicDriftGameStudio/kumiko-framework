import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor.js";
import { buildEntityTable } from "../../db/table-builder.js";
import { createEntity, createTextField, defineFeature } from "../../engine/index.js";
import type { HandlerContext, NotifyFactory } from "../../engine/types/index.js";
import { TestUsers } from "../../seeding/seed-users.js";

// ctx.notify / ctx.scheduleAfterCommit across the ctx.query bridge: a notify raised inside a
// query called from a write handler must wait for that write's commit, and the post-commit
// context has no commit sink to schedule on.

const thingEntity = createEntity({
  table: "nfy_things",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const thingTable = buildEntityTable("thing", thingEntity);
const thingCrud = createEventStoreExecutor(thingTable, thingEntity, { entityName: "thing" });

type NotifyCall = { readonly path: "afterCommit" | "inTransaction"; readonly type: string };
const notifyCalls: NotifyCall[] = [];
const effectLog: string[] = [];
let hookScheduleType: string | undefined;
let queryBridgeScheduleType: string | undefined;

// Only the in-transaction notify gets a delivery pool, so the argument tells the two paths apart.
const notifyFactory: NotifyFactory = (_user, _tenantId, _jobs, deliveryDb) => async (type) => {
  notifyCalls.push({ path: deliveryDb === undefined ? "afterCommit" : "inTransaction", type });
  return { kind: "dispatched", deliveries: [] };
};

const openToAll = { openToAll: { reason: "test handler callable by any signed-in test user" } };

const notifyFeature = defineFeature("nfy", (r) => {
  const thing = r.entity({ name: "thing", ...thingEntity });

  r.writeHandler({
    name: "thing:create",
    schema: z.object({ label: z.string() }),
    handler: async (event, ctx) => thingCrud.create(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });

  r.queryHandler({
    name: "probe:notify",
    schema: z.object({}),
    handler: async (_query, ctx) => {
      await ctx.notify?.("nfy-probe", { route: { email: "probe@example.com" } });
      return { notified: true };
    },
    access: openToAll,
  });

  r.queryHandler({
    name: "probe:schedule",
    schema: z.object({}),
    handler: async (_query, ctx) => ({ scheduleType: typeof ctx.scheduleAfterCommit }),
    access: openToAll,
  });

  r.writeHandler({
    name: "bridge:notify",
    schema: z.object({ rollBack: z.boolean() }),
    handler: async (event, ctx) => {
      await ctx.query("nfy:query:probe:notify", {});
      const probe = await ctx.query("nfy:query:probe:schedule", {});
      queryBridgeScheduleType = z.object({ scheduleType: z.string() }).parse(probe).scheduleType;
      if (event.payload.rollBack) throw new Error("outer write fails after the bridged notify");
      return { isSuccess: true as const, data: {} };
    },
    access: { roles: ["Admin"] },
  });

  // Callers like announce-secret-change run inline when there is no commit sink to schedule on.
  r.writeHandler({
    name: "effect:run",
    schema: z.object({}),
    handler: async (_event, ctx) => {
      const effect = async () => {
        effectLog.push("effect-ran");
      };
      if (ctx.scheduleAfterCommit) ctx.scheduleAfterCommit(effect);
      else await effect();
      return { isSuccess: true as const, data: {} };
    },
    access: { roles: ["Admin"] },
  });

  r.hook({
    type: "postSave",
    target: { allOf: thing },
    handler: async (_result, ctx) => {
      // Hooks are typed against AppContext; the runtime object is the full HandlerContext. @cast-boundary
      const handlerCtx = ctx as unknown as HandlerContext;
      hookScheduleType = typeof handlerCtx.scheduleAfterCommit;
      await handlerCtx.write("nfy:write:effect:run", {});
    },
  });
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [notifyFeature],
    extraContext: { _notifyFactory: notifyFactory },
  });
  await unsafeCreateEntityTable(stack.db, thingEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  notifyCalls.length = 0;
  effectLog.length = 0;
  hookScheduleType = undefined;
  queryBridgeScheduleType = undefined;
  await stack.redis.flushNamespace();
});

describe("ctx.notify inside a ctx.query bridge of a write handler", () => {
  test("a rolled-back outer write leaves no notification behind", async () => {
    const res = await stack.http.write("nfy:write:bridge:notify", { rollBack: true }, admin);
    expect(res.status).toBe(500);
    expect(notifyCalls).toEqual([]);
  });

  test("a committed outer write delivers the bridged notify once, after the commit", async () => {
    const res = await stack.http.write("nfy:write:bridge:notify", { rollBack: false }, admin);
    expect((await res.json()).isSuccess).toBe(true);
    expect(notifyCalls).toEqual([{ path: "afterCommit", type: "nfy-probe" }]);
  });
});

describe("ctx.scheduleAfterCommit without a live commit sink", () => {
  test("is absent in the ctx.query bridge context", async () => {
    const res = await stack.http.write("nfy:write:bridge:notify", { rollBack: false }, admin);
    expect((await res.json()).isSuccess).toBe(true);
    expect(queryBridgeScheduleType).toBe("undefined");
  });

  test("is absent in an afterCommit hook, and a write it dispatches still takes effect", async () => {
    const res = await stack.http.write("nfy:write:thing:create", { label: "hooked" }, admin);
    expect((await res.json()).isSuccess).toBe(true);
    expect(hookScheduleType).toBe("undefined");
    expect(effectLog).toEqual(["effect-ran"]);
  });
});

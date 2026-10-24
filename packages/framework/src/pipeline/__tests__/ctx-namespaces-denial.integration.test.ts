// Each phase that must not write names the namespaced path of the surface it denies:
// reserveBeforeTransaction and beforeTransaction (before the transaction), and a top-level query
// handler (no open transaction). The member-resolution phase is pinned in
// member-resolution-read-only.test.ts, which needs no HTTP stack.

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
import { createEntity, createTextField, defineFeature } from "../../engine/index.ts";
import { eventsTable } from "../../event-store/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const noteEntity = createEntity({
  table: "ctx_ns_deny_notes",
  fields: { title: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});
const noteTable = buildEntityTable("note", noteEntity);
const noteExecutor = createEventStoreExecutor(noteTable, noteEntity, { entityName: "note" });

const FEATURE = "ctxnsdeny";

const EVENT_MEMBERS = [
  "append",
  "unsafeAppend",
  "tryAppend",
  "fetchForWriting",
  "archive",
  "restore",
  "snapshot",
] as const;
const DISPATCH_WRITE_MEMBERS = ["write", "writeAs"] as const;

const WRITING_MEMBERS = [
  ...EVENT_MEMBERS.map((member) => ({ namespace: "events", member })),
  ...DISPATCH_WRITE_MEMBERS.map((member) => ({ namespace: "dispatch", member })),
];

const memberPayload = z.object({
  namespace: z.enum(["events", "dispatch"]),
  member: z.string(),
});

const outsideShapes: { readonly phase: string; readonly outsideDefined: boolean }[] = [];
const handlerCalls: string[] = [];

// The phase contexts have no events namespace at the type level, so the runtime denial is
// reached by name; calling a denied member throws before it looks at its arguments.
async function callWritingMember(
  ctx: object,
  { namespace, member }: z.infer<typeof memberPayload>,
): Promise<void> {
  const owner: unknown = Reflect.get(ctx, namespace);
  const surface = typeof owner === "object" && owner !== null ? Reflect.get(owner, member) : null;
  if (typeof surface !== "function") {
    throw new Error(`ctx.${namespace}.${member} is not a function on this context`);
  }
  await surface.call(owner);
}

const denyFeature = defineFeature(FEATURE, (r) => {
  r.entity({ name: "note", ...noteEntity });

  r.writeHandler({
    name: "reserve-denied",
    schema: memberPayload,
    access: { roles: ["Admin"] },
    reserveBeforeTransaction: async (event, ctx) => {
      outsideShapes.push({
        phase: "reservation",
        outsideDefined: ctx.db.outsideTransaction !== undefined,
      });
      await callWritingMember(ctx, memberPayload.parse(event.payload));
      return undefined;
    },
    handler: async () => {
      handlerCalls.push("reserve-denied");
      return { isSuccess: true as const, data: {} };
    },
  });

  r.writeHandler({
    name: "before-denied",
    schema: memberPayload,
    access: { roles: ["Admin"] },
    beforeTransaction: async (event, ctx) => {
      outsideShapes.push({
        phase: "beforeTransaction",
        outsideDefined: ctx.db.outsideTransaction !== undefined,
      });
      await callWritingMember(ctx, event.payload);
      return { isSuccess: true as const, data: undefined };
    },
    handler: async () => {
      handlerCalls.push("before-denied");
      return { isSuccess: true as const, data: {} };
    },
  });

  r.queryHandler({
    name: "without-transaction",
    schema: memberPayload,
    handler: async (query, ctx) => {
      await callWritingMember(ctx, query.payload);
      return null;
    },
    access: { roles: ["Admin"] },
  });

  r.writeHandler({
    name: "plain-create",
    schema: z.object({ title: z.string() }),
    handler: async (event, ctx) => noteExecutor.create(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [denyFeature] });
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [noteTable, eventsTable]);
  outsideShapes.length = 0;
  handlerCalls.length = 0;
});

describe("denied writing members name their namespaced path", () => {
  test.each(WRITING_MEMBERS)(
    "reserveBeforeTransaction denies ctx.$namespace.$member",
    async (target) => {
      const error = await stack.http.writeErr(`${FEATURE}:write:reserve-denied`, target, admin);

      expect(error.httpStatus).toBe(500);
      expect(error.message).toContain(
        `ctx.${target.namespace}.${target.member} is not available before the transaction`,
      );
      expect(handlerCalls).toEqual([]);
      expect(await selectMany(stack.db, eventsTable, {})).toEqual([]);
    },
  );

  test.each(WRITING_MEMBERS)("beforeTransaction denies ctx.$namespace.$member", async (target) => {
    const error = await stack.http.writeErr(`${FEATURE}:write:before-denied`, target, admin);

    expect(error.httpStatus).toBe(500);
    expect(error.message).toContain(
      `ctx.${target.namespace}.${target.member} is not available before the transaction`,
    );
    expect(handlerCalls).toEqual([]);
    expect(await selectMany(stack.db, eventsTable, {})).toEqual([]);
  });

  test.each(EVENT_MEMBERS)(
    "a query handler without a transaction denies ctx.events.%s",
    async (member) => {
      const error = await stack.http.queryErr(
        `${FEATURE}:query:without-transaction`,
        { namespace: "events", member },
        admin,
      );

      expect(error.httpStatus).toBe(500);
      expect(error.message).toContain(
        `ctx.events.${member} is not available without an open transaction`,
      );
      expect(await selectMany(stack.db, eventsTable, {})).toEqual([]);
    },
  );

  test("db.outsideTransaction exists in the reservation and is gone in beforeTransaction", async () => {
    const target = { namespace: "events", member: "append" } as const;
    await stack.http.writeErr(`${FEATURE}:write:reserve-denied`, target, admin);
    await stack.http.writeErr(`${FEATURE}:write:before-denied`, target, admin);

    expect(outsideShapes).toEqual([
      { phase: "reservation", outsideDefined: true },
      { phase: "beforeTransaction", outsideDefined: false },
    ]);
  });

  test("an ordinary write handler still commits", async () => {
    await stack.http.writeOk(`${FEATURE}:write:plain-create`, { title: "ok" }, admin);

    const rows = await selectMany<{ title: string }>(stack.db, noteTable, {});
    expect(rows.map((row) => row.title)).toEqual(["ok"]);
  });
});

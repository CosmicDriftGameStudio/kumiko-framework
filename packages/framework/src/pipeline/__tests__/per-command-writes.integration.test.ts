// Contexts without an open transaction (stream/top-level query handlers, perCommand handlers) send
// ctx.dispatch.write through their own top-level command, and their ctx.db / event-store writes throw.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { defineUnmanagedTable } from "../../db/entity-table-meta.ts";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { executeRawQuery } from "../../db/queries/raw-sql.ts";
import { selectMany } from "../../db/query.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import {
  createEntity,
  createTextField,
  defineFeature,
  defineWriteHandler,
} from "../../engine/index.ts";
import { UnprocessableError, writeFailure } from "../../errors/index.ts";
import { eventsTable } from "../../event-store/index.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";

const noteEntity = createEntity({
  table: "per_command_notes",
  fields: { title: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});
const noteTable = buildEntityTable("note", noteEntity);
const noteExecutor = createEventStoreExecutor(noteTable, noteEntity, { entityName: "note" });

const plainTable = defineUnmanagedTable({
  tableName: "per_command_plain",
  columns: [
    { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "title", pgType: "text", notNull: true },
  ],
});

const FEATURE = "per-cmd";
const type = (kind: "write" | "query" | "stream", name: string) => `${FEATURE}:${kind}:${name}`;

type Deferred = { promise: Promise<void>; resolve: () => void };
function deferred(): Deferred {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const afterCommitTitles: string[] = [];
const beforeCalls: string[] = [];
let phaseEntered = deferred();
let phaseGate = deferred();

let failAlwaysCalls = 0;

const titlePayload = z.object({ title: z.string() });

const feature = defineFeature(FEATURE, (r) => {
  const note = r.entity({ name: "note", ...noteEntity });

  r.hook({
    type: "postSave",
    target: { allOf: note },
    handler: async (result) => {
      afterCommitTitles.push(String(result.data["title"]));
    },
  });

  r.writeHandler(
    defineWriteHandler({
      name: "create-note",
      schema: titlePayload,
      access: { roles: ["Admin"] },
      handler: async (event, ctx) => {
        return noteExecutor.create({ title: event.payload.title }, ctx.user, ctx.db);
      },
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "create-note-prepared",
      schema: titlePayload,
      access: { roles: ["Admin"] },
      beforeTransaction: async (event) => {
        beforeCalls.push(event.payload.title);
        phaseEntered.resolve();
        await phaseGate.promise;
        return { isSuccess: true as const, data: { token: `prepared-${event.payload.title}` } };
      },
      handler: async (event, ctx) => {
        return noteExecutor.create({ title: event.prepared.token }, ctx.user, ctx.db);
      },
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "orchestrate",
      schema: titlePayload,
      access: { roles: ["Admin"] },
      transaction: "perCommand",
      handler: async (event, ctx) => {
        const first = await ctx.dispatch.write(type("write", "create-note-prepared"), {
          title: event.payload.title,
        });
        if (!first.isSuccess) return first;
        return ctx.dispatch.write(type("write", "create-note"), {
          title: `${event.payload.title}-plain`,
        });
      },
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "orchestrate-db-write",
      schema: titlePayload,
      access: { roles: ["Admin"] },
      transaction: "perCommand",
      handler: async (event, ctx) => {
        await noteExecutor.create({ title: event.payload.title }, ctx.user, ctx.db);
        return { isSuccess: true as const, data: {} };
      },
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "orchestrate-for-tenant-write",
      schema: z.object({ targetTenant: z.number() }),
      access: { roles: ["Admin", "SystemAdmin"] },
      transaction: "perCommand",
      handler: async (event, ctx) => {
        const target = ctx.tenants.writeTarget?.(testTenantId(event.payload.targetTenant));
        if (!target) throw new Error("forTenant is expected in a write handler context");
        await noteExecutor.create({ title: "via-for-tenant" }, ctx.user, target.db);
        return { isSuccess: true as const, data: {} };
      },
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "orchestrate-read",
      schema: titlePayload,
      access: { roles: ["Admin"] },
      transaction: "perCommand",
      handler: async (_event, ctx) => {
        const rows = await selectMany<{ title: string }>(ctx.db, noteTable, {});
        return { isSuccess: true as const, data: { titles: rows.map((row) => row.title) } };
      },
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "nest-per-command",
      schema: titlePayload,
      access: { roles: ["Admin"] },
      handler: async (event, ctx) => {
        const created = await noteExecutor.create({ title: event.payload.title }, ctx.user, ctx.db);
        if (!created.isSuccess) return created;
        return ctx.dispatch.write(type("write", "orchestrate"), { title: event.payload.title });
      },
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "before-db-write",
      schema: titlePayload,
      access: { roles: ["Admin"] },
      beforeTransaction: async (event, ctx) => {
        await noteExecutor.create({ title: event.payload.title }, ctx.user, ctx.db);
        return { isSuccess: true as const, data: undefined };
      },
      handler: async () => ({ isSuccess: true as const, data: {} }),
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "reserve-db-write",
      schema: titlePayload,
      access: { roles: ["Admin"] },
      reserveBeforeTransaction: async (event, ctx) => {
        const { title } = titlePayload.parse(event.payload);
        await noteExecutor.create({ title }, ctx.user, ctx.db);
        return undefined;
      },
      handler: async () => ({ isSuccess: true as const, data: {} }),
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "reserve-for-tenant",
      schema: titlePayload,
      access: { roles: ["Admin"] },
      reserveBeforeTransaction: async (event, ctx) => {
        const { title } = titlePayload.parse(event.payload);
        const target = ctx.tenants.writeTarget?.(ctx.user.tenantId);
        if (!target) throw new Error("forTenant is expected in a write handler context");
        await noteExecutor.create({ title }, ctx.user, target.db);
        return undefined;
      },
      handler: async () => ({ isSuccess: true as const, data: {} }),
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "fail-always",
      schema: titlePayload,
      access: { roles: ["Admin"] },
      handler: async () => {
        failAlwaysCalls += 1;
        return writeFailure(new UnprocessableError("always_fails"));
      },
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "orchestrate-partial",
      schema: titlePayload,
      access: { roles: ["Admin"] },
      transaction: "perCommand",
      handler: async (event, ctx) => {
        const first = await ctx.dispatch.write(type("write", "create-note"), {
          title: event.payload.title,
        });
        if (!first.isSuccess) return first;
        return ctx.dispatch.write(type("write", "fail-always"), { title: event.payload.title });
      },
    }),
  );

  r.streamHandler(
    "stream-user-write",
    titlePayload,
    async function* (query, ctx) {
      const res = await ctx.dispatch.write(type("write", "create-note"), {
        title: query.payload.title,
      });
      yield res.isSuccess ? "written" : `rejected:${res.error.code}`;
    },
    { access: { roles: ["User"] } },
  );

  r.streamHandler(
    "stream-write-as-other",
    titlePayload,
    async function* (query, ctx) {
      try {
        const res = await ctx.dispatch.writeAs(otherAdmin, type("write", "create-note"), {
          title: query.payload.title,
        });
        yield res.isSuccess ? "written" : `rejected:${res.error.code}`;
      } catch (error) {
        yield `threw:${error instanceof Error ? error.message : "unknown"}`;
      }
    },
    { access: { roles: ["Admin"] } },
  );

  r.streamHandler(
    "stream-write-per-command",
    titlePayload,
    async function* (query, ctx) {
      const res = await ctx.dispatch.write(type("write", "orchestrate"), {
        title: query.payload.title,
      });
      yield res.isSuccess ? "written" : "write-failed";
    },
    { access: { roles: ["Admin"] } },
  );

  r.queryHandler({
    name: "query-user-write",
    schema: titlePayload,
    handler: async (query, ctx) =>
      ctx.dispatch.write(type("write", "create-note"), { title: query.payload.title }),
    access: { roles: ["User"] },
  });

  r.streamHandler(
    "stream-write",
    titlePayload,
    async function* (query, ctx) {
      const res = await ctx.dispatch.write(type("write", "create-note"), {
        title: query.payload.title,
      });
      yield res.isSuccess ? "written" : "write-failed";
    },
    { access: { roles: ["Admin"] } },
  );

  r.streamHandler(
    "stream-db-write",
    titlePayload,
    async function* (query, ctx) {
      await noteExecutor.create({ title: query.payload.title }, ctx.user, ctx.db);
      yield "written";
    },
    { access: { roles: ["Admin"] } },
  );

  r.streamHandler(
    "stream-insert-one",
    titlePayload,
    async function* (query, ctx) {
      await ctx.db.insertOne(plainTable, { title: query.payload.title });
      yield "written";
    },
    { access: { roles: ["Admin"] } },
  );

  r.streamHandler(
    "stream-append",
    titlePayload,
    async function* (_query, ctx) {
      await ctx.events.unsafeAppend({
        aggregateId: "00000000-0000-4000-8000-000000000002",
        aggregateType: "note",
        type: "note.created",
        payload: { title: "sneaky" },
      });
      yield "appended";
    },
    { access: { roles: ["Admin"] } },
  );

  r.queryHandler({
    name: "query-write",
    schema: titlePayload,
    handler: async (query, ctx) =>
      ctx.dispatch.write(type("write", "create-note"), { title: query.payload.title }),
    access: { roles: ["Admin"] },
  });

  r.queryHandler({
    name: "query-db-write",
    schema: titlePayload,
    handler: async (query, ctx) => {
      await noteExecutor.create({ title: query.payload.title }, ctx.user, ctx.db);
      return {};
    },
    access: { roles: ["Admin"] },
  });

  r.queryHandler({
    name: "query-append",
    schema: titlePayload,
    handler: async (_query, ctx) => {
      await ctx.events.unsafeAppend({
        aggregateId: "00000000-0000-4000-8000-000000000003",
        aggregateType: "note",
        type: "note.created",
        payload: { title: "sneaky" },
      });
      return {};
    },
    access: { roles: ["Admin"] },
  });
});

let stack: TestStack;
const admin = createTestUser({ id: 1, tenantId: testTenantId(9502), roles: ["Admin"] });
const plainUser = createTestUser({ id: 3, tenantId: testTenantId(9502), roles: ["User"] });
const systemAdmin = createTestUser({ id: 4, tenantId: testTenantId(9502), roles: ["SystemAdmin"] });
const otherAdmin = createTestUser({ id: 2, tenantId: testTenantId(9502), roles: ["Admin"] });

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [noteTable, eventsTable]);
  afterCommitTitles.length = 0;
  beforeCalls.length = 0;
  failAlwaysCalls = 0;
  phaseEntered = deferred();
  phaseGate = deferred();
});

async function noteTitles(): Promise<string[]> {
  const rows = await selectMany<{ title: string }>(stack.db, noteTable, {});
  return rows.map((row) => row.title).sort();
}

async function consumeStream(
  name: string,
  payload: unknown,
  user: typeof admin = admin,
): Promise<string> {
  const headers = { Authorization: `Bearer ${await stack.jwt.sign(user)}` };
  const res = await stack.http.raw(
    "POST",
    "/api/stream",
    { type: type("stream", name), payload },
    headers,
  );
  return res.text();
}

async function idleInTransactionCount(): Promise<number> {
  const rows = await executeRawQuery<{ count: number }>(
    stack.db,
    `SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname = current_database() AND state = 'idle in transaction'`,
  );
  return rows[0]?.count ?? -1;
}

describe("perCommand handler", () => {
  test("a command with beforeTransaction runs its phase with no transaction open, then commits", async () => {
    const pending = stack.http.writeOk(type("write", "orchestrate"), { title: "a" }, admin);
    await phaseEntered.promise;

    expect(beforeCalls).toEqual(["a"]);
    expect(await idleInTransactionCount()).toBe(0);
    expect(await noteTitles()).toEqual([]);

    phaseGate.resolve();
    await pending;

    expect(await noteTitles()).toEqual(["a-plain", "prepared-a"]);
    expect([...afterCommitTitles].sort()).toEqual(["a-plain", "prepared-a"]);
  });

  test("ctx.db reads work, ctx.db writes throw", async () => {
    await stack.http.writeOk(type("write", "create-note"), { title: "seed" }, admin);

    const data = await stack.http.writeOk<{ titles: string[] }>(
      type("write", "orchestrate-read"),
      { title: "x" },
      admin,
    );
    expect(data.titles).toEqual(["seed"]);

    const error = await stack.http.writeErr(
      type("write", "orchestrate-db-write"),
      { title: "x" },
      admin,
    );
    expect(error.httpStatus).toBe(500);
    expect(error.message).toContain("writes are not available without an open transaction");
    expect(await noteTitles()).toEqual(["seed"]);
  });

  test.each([
    { target: "own tenant", targetTenant: 9502 },
    { target: "foreign tenant", targetTenant: 9503 },
  ])(
    "a write through forTenant on the $target throws and persists nothing",
    async ({ targetTenant }) => {
      const error = await stack.http.writeErr(
        type("write", "orchestrate-for-tenant-write"),
        { targetTenant },
        systemAdmin,
      );

      expect(error.httpStatus).toBe(500);
      expect(error.message).toContain("writes are not available without an open transaction");
      expect(await noteTitles()).toEqual([]);
    },
  );

  test("as a nested ctx.dispatch.write it is rejected and the outer write rolls back", async () => {
    const error = await stack.http.writeErr(
      type("write", "nest-per-command"),
      { title: "n" },
      admin,
    );

    expect(error.httpStatus).toBe(500);
    expect(error.message).toContain(`transaction: "perCommand"`);
    expect(await noteTitles()).toEqual([]);
  });

  test("inside a multi-command batch it is rejected with 422 and nothing is written", async () => {
    const res = await stack.http.batch(
      [
        { type: type("write", "create-note"), payload: { title: "first" } },
        { type: type("write", "orchestrate-read"), payload: { title: "second" } },
      ],
      admin,
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { details: { reason: string } } };
    expect(body.error.details.reason).toBe("per_command_handler_in_batch");
    expect(await noteTitles()).toEqual([]);
  });

  test("a single-command batch is allowed", async () => {
    phaseGate.resolve();
    const res = await stack.http.batch(
      [{ type: type("write", "orchestrate"), payload: { title: "solo" } }],
      admin,
    );
    expect(res.status).toBe(200);
    expect(await noteTitles()).toEqual(["prepared-solo", "solo-plain"]);
  });
});

describe("ctx.dispatch.write without an open transaction", () => {
  test("a stream handler's write commits on its own and fires the afterCommit hook", async () => {
    const body = await consumeStream("stream-write", { title: "streamed" });

    expect(body).toContain("written");
    expect(await noteTitles()).toEqual(["streamed"]);
    expect(afterCommitTitles).toEqual(["streamed"]);
  });

  test("a top-level query handler's write commits on its own and fires the afterCommit hook", async () => {
    await stack.http.queryOk(type("query", "query-write"), { title: "queried" }, admin);

    expect(await noteTitles()).toEqual(["queried"]);
    expect(afterCommitTitles).toEqual(["queried"]);
  });
});

describe("ctx.db writes without an open transaction", () => {
  test("a stream handler's executor create and insertOne throw, nothing is written", async () => {
    expect(await consumeStream("stream-db-write", { title: "x" })).toContain(
      "writes are not available without an open transaction",
    );
    expect(await consumeStream("stream-insert-one", { title: "y" })).toContain(
      "ctx.db.insertOne: writes are not available without an open transaction",
    );
    expect(await noteTitles()).toEqual([]);
  });

  test("a top-level query handler's executor create throws, nothing is written", async () => {
    const error = await stack.http.queryErr(type("query", "query-db-write"), { title: "x" }, admin);

    expect(error.message).toContain("writes are not available without an open transaction");
    expect(await noteTitles()).toEqual([]);
  });

  test("event appends in stream and query handlers throw", async () => {
    expect(await consumeStream("stream-append", { title: "x" })).toContain(
      "ctx.events.unsafeAppend is not available without an open transaction",
    );
    const error = await stack.http.queryErr(type("query", "query-append"), { title: "x" }, admin);
    expect(error.message).toContain(
      "ctx.events.unsafeAppend is not available without an open transaction",
    );
    expect(await selectMany(stack.db, eventsTable, {})).toEqual([]);
  });

  test("reserveBeforeTransaction keeps writing through forTenant", async () => {
    await stack.http.writeOk(type("write", "reserve-for-tenant"), { title: "reserved" }, admin);

    expect(await noteTitles()).toEqual(["reserved"]);
  });

  test("beforeTransaction and reserveBeforeTransaction cannot write through ctx.db", async () => {
    const before = await stack.http.writeErr(
      type("write", "before-db-write"),
      { title: "b" },
      admin,
    );
    const reserve = await stack.http.writeErr(
      type("write", "reserve-db-write"),
      { title: "r" },
      admin,
    );

    expect(before.message).toContain("writes are not available without an open transaction");
    expect(reserve.message).toContain("writes are not available without an open transaction");
    expect(await noteTitles()).toEqual([]);
  });
});

describe("ctx.dispatch.write keeps the caller's gates without an open transaction", () => {
  test("a non-admin stream handler cannot write to an admin-only handler", async () => {
    const body = await consumeStream("stream-user-write", { title: "sneaky" }, plainUser);

    expect(body).toContain("rejected:access_denied");
    expect(await noteTitles()).toEqual([]);
  });

  test("a non-admin top-level query handler cannot write to an admin-only handler", async () => {
    const res = await stack.http.query(
      type("query", "query-user-write"),
      { title: "sneaky" },
      plainUser,
    );
    const body = (await res.json()) as { isSuccess?: boolean; error?: { code?: string } };

    expect(JSON.stringify(body)).toContain("access_denied");
    expect(await noteTitles()).toEqual([]);
  });

  test("a stream handler cannot writeAs another user without a system scope", async () => {
    const body = await consumeStream("stream-write-as-other", { title: "switched" });

    expect(body).not.toContain("written");
    expect(await noteTitles()).toEqual([]);
  });
});

describe("perCommand partial commits", () => {
  test("a failing second write keeps the first committed and fails the outer result", async () => {
    const error = await stack.http.writeErr(
      type("write", "orchestrate-partial"),
      { title: "kept" },
      admin,
    );

    expect(error.message).toContain("always_fails");
    expect(await noteTitles()).toEqual(["kept"]);
  });

  test("a repeated request id replays the cached failure without another write", async () => {
    const requestId = "per-command-partial-1";
    const send = async () =>
      (
        await stack.http.write(
          type("write", "orchestrate-partial"),
          { title: "once" },
          admin,
          requestId,
        )
      ).json() as Promise<{ isSuccess: boolean; error?: { message?: string } }>;

    const first = await send();
    const second = await send();

    expect(first.isSuccess).toBe(false);
    expect(second.isSuccess).toBe(false);
    expect(second.error?.message).toEqual(first.error?.message);
    expect(failAlwaysCalls).toBe(1);
    expect(await noteTitles()).toEqual(["once"]);
  });

  test("a stream handler may call a perCommand handler and its inner writes commit", async () => {
    phaseGate.resolve();
    const body = await consumeStream("stream-write-per-command", { title: "s" });

    expect(body).toContain("written");
    expect(await noteTitles()).toEqual(["prepared-s", "s-plain"]);
  });
});

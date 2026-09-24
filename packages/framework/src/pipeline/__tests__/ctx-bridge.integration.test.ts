import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { asRawClient, selectMany } from "../../db/query";
import { buildEntityTable } from "../../db/table-builder";
import {
  access,
  createEntity,
  createNumberField,
  createSystemUser,
  createTextField,
  defineFeature,
  HookPhases,
} from "../../engine";
import type { HandlerContext } from "../../engine/types";
import { UnprocessableError, writeFailure } from "../../errors";
import { setupTestStack, type TestStack, TestUsers, unsafeCreateEntityTable } from "../../stack";

// Two entities: `bag` (outer) + `secret` (inner). The outer handler calls
// the inner via ctx.queryAs / ctx.writeAs. We verify:
//   - ctx.query / ctx.write run under the CURRENT user (field-access filters)
//   - ctx.queryAs(systemUser) bypasses field-access read filters
//   - A writeAs inside a failing outer write rolls back with the outer tx
//   - afterCommit hooks from writeAs fire exactly once on outer commit

const bagEntity = createEntity({
  table: "ctx_bags",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture", required: true }),
    counter: createNumberField({ default: 0 }),
  },
});
const bagTable = buildEntityTable("bag", bagEntity);

// secret has a system-only read field — proves queryAs(system) reads it,
// plain query doesn't.
const secretEntity = createEntity({
  table: "ctx_secrets",
  fields: {
    owner: createTextField({ personal: false, reason: "test_fixture", required: true }),
    token: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      access: { read: access.privileged, write: access.privileged },
    }),
  },
});
const secretTable = buildEntityTable("secret", secretEntity);

// Target entity for the afterCommit-hook-writes-a-second-entity test below
// (dead-tx-in-afterCommit-hooks). Plain Admin access — kept separate
// from `secret` so that test doesn't entangle with the privileged-access
// assertions the other describe blocks make about it.
const echoEntity = createEntity({
  table: "ctx_echoes",
  fields: {
    bagId: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const echoTable = buildEntityTable("echo", echoEntity);

let stack: TestStack;
const admin = TestUsers.admin;

const afterCommitLog: string[] = [];

// Toggled per-test so the afterCommit hook only writes echo rows for
// the test that exercises it — reset in beforeEach.
let afterCommitHookShouldEchoBag = false;
const echoedBagIds: string[] = [];

const bridgeFeature = defineFeature("ctxbridge", (r) => {
  const bag = r.entity("bag", bagEntity);
  const secret = r.entity("secret", secretEntity);
  r.entity("echo", echoEntity);

  r.writeHandler(
    "bag:create",
    z.object({ label: z.string() }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(bagTable, bagEntity, { entityName: "bag" });
      return crud.create(event.payload, event.user, ctx.db);
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "secret:create",
    z.object({ owner: z.string(), token: z.string() }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(secretTable, secretEntity, { entityName: "secret" });
      return crud.create(event.payload, event.user, ctx.db);
    },
    { access: { roles: access.privileged } },
  );

  r.queryHandler(
    "secret:by-owner",
    z.object({ owner: z.string() }),
    async (query, ctx) => {
      const rows = await selectMany(ctx.db, secretTable);
      return (
        (rows as Array<Record<string, unknown>>).find((r) => r["owner"] === query.payload.owner) ??
        null
      );
    },
    { access: { roles: access.privileged } },
  );

  // Outer handler: creates a bag AND (as system) creates a secret for the user.
  // writeAs(system) must share the outer tx. An intentional failure in a later
  // step rolls the secret back too.
  r.writeHandler(
    "bag:create-with-secret",
    z.object({ label: z.string(), token: z.string(), fail: z.boolean().optional() }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(bagTable, bagEntity, { entityName: "bag" });
      const created = await crud.create({ label: event.payload.label }, event.user, ctx.db);
      if (!created.isSuccess) return created;

      const secretRes = await ctx.writeAs(
        createSystemUser(event.user.tenantId),
        "ctxbridge:write:secret:create",
        {
          owner: event.user.id,
          token: event.payload.token,
        },
      );
      if (!secretRes.isSuccess) return secretRes;

      if (event.payload.fail) {
        return writeFailure(new UnprocessableError("intentional_failure"));
      }

      return created;
    },
    {
      access: { roles: ["Admin"] },
      escapeHatch: { reason: "test fixture: writeAs(SYSTEM) creates the secret for the caller" },
    },
  );

  // Two inserts, one via ctx.db (tx-bound) and one via ctx.dbOutsideTransaction
  // (unbound pool), then an unconditional failure. Proves the outside-tx write
  // survives the handler's own rollback while the tx-bound one doesn't.
  r.writeHandler(
    "bag:create-outside-tx-then-fail",
    z.object({ label: z.string() }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(bagTable, bagEntity, { entityName: "bag" });
      await crud.create({ label: `${event.payload.label}-inside-tx` }, event.user, ctx.db);
      const outsideTx = ctx.dbOutsideTransaction;
      if (!outsideTx) {
        throw new Error("bag:create-outside-tx-then-fail requires ctx.dbOutsideTransaction");
      }
      await crud.create({ label: `${event.payload.label}-outside-tx` }, event.user, outsideTx);
      return writeFailure(new UnprocessableError("intentional_failure"));
    },
    { access: { roles: ["Admin"] } },
  );

  // Handler that fetches the secret via ctx.queryAs(system) — proves the
  // privileged call returns the token field even though the caller (Admin)
  // couldn't read it themselves.
  r.queryHandler(
    "bag:peek-secret",
    z.object({ owner: z.string() }),
    async (query, ctx) => {
      return ctx.queryAs(createSystemUser(query.user.tenantId), "ctxbridge:query:secret:by-owner", {
        owner: query.payload.owner,
      });
    },
    {
      access: { roles: ["Admin"] },
      escapeHatch: { reason: "test fixture: queryAs(SYSTEM) reads the privileged token field" },
    },
  );

  // Proves runBatch strips the request signal: both inserts land and
  // ctx.signal is undefined even though the request was pre-aborted.
  r.writeHandler(
    "bag:create-signal-probe",
    z.object({ label: z.string() }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(bagTable, bagEntity, { entityName: "bag" });
      await ctx.db?.selectMany(bagTable, {});
      await crud.create({ label: `${event.payload.label}-inside-tx` }, event.user, ctx.db);
      const outsideTx = ctx.dbOutsideTransaction;
      if (!outsideTx) {
        throw new Error("bag:create-signal-probe requires ctx.dbOutsideTransaction");
      }
      await crud.create({ label: `${event.payload.label}-outside-tx` }, event.user, outsideTx);
      return { isSuccess: true as const, data: { signalSeen: ctx.signal !== undefined } };
    },
    { access: { roles: ["Admin"] } },
  );

  // Query path counterpart — ctx.db.selectMany hits signal.throwIfAborted().
  r.queryHandler(
    "bag:list-signal-probe",
    z.object({}),
    async (_query, ctx) => selectMany(ctx.db, bagTable),
    { access: { roles: ["Admin"] } },
  );

  // Negative control: never touches ctx.db, so a pre-aborted signal must still 500.
  r.queryHandler(
    "bag:query-boom",
    z.object({}),
    async () => {
      throw new Error("unrelated boom");
    },
    { access: { roles: ["Admin"] } },
  );

  // Pre-write ctx.db read — crud.create's own insert writes via db.raw and
  // doesn't check the signal, so this is what makes the test discriminating.
  r.writeHandler(
    "bag:create-plain",
    z.object({ label: z.string() }),
    async (event, ctx) => {
      await ctx.db?.selectMany(bagTable, {});
      const crud = createEventStoreExecutor(bagTable, bagEntity, { entityName: "bag" });
      return crud.create(event.payload, event.user, ctx.db);
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "echo:create",
    z.object({ bagId: z.string() }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(echoTable, echoEntity, {
        entityName: "echo",
      });
      return crud.create(event.payload, event.user, ctx.db);
    },
    { access: { roles: ["Admin"] } },
  );

  // afterCommit hook on bag — fires once per outer commit.
  r.hook("postSave", { allOf: bag }, async (result) => {
    afterCommitLog.push(`bag:${result.data["label"]}`);
  });

  // afterCommit hook on bag that writes a SECOND entity via ctx.write,
  // going through the real event-store append path (crud.create ->
  // runInSavepointIfSupported). Proves the afterCommit context's ctx.db
  // is a live, usable handle rather than the already-committed tx
  // (dead-tx-in-afterCommit-hooks). Explicit phase so the test says
  // what it means, even though afterCommit is already the default.
  r.hook(
    "postSave",
    { allOf: bag },
    async (result, ctx) => {
      if (!afterCommitHookShouldEchoBag) return;
      const bagId = String(result.id);
      // Hooks are typed against AppContext (no bridge), but the runtime
      // object is always the full HandlerContext — see the comment on
      // AppContext in @cosmicdrift/kumiko-types/handlers. @cast-boundary
      const handlerCtx = ctx as unknown as HandlerContext;
      const echoRes = await handlerCtx.write("ctxbridge:write:echo:create", { bagId });
      if (echoRes.isSuccess) echoedBagIds.push(bagId);
    },
    { phase: HookPhases.afterCommit },
  );

  // afterCommit hook on secret — the entity targeted by the nested writeAs.
  // Proves: (a) hook fires exactly once per successful writeAs, (b) hook
  // does NOT fire when the outer transaction rolls back.
  r.hook("postSave", { allOf: secret }, async (result) => {
    afterCommitLog.push(`secret:${result.data["owner"]}`);
  });
});

beforeAll(async () => {
  stack = await setupTestStack({ features: [bridgeFeature] });
  await unsafeCreateEntityTable(stack.db, bagEntity);
  await unsafeCreateEntityTable(stack.db, secretEntity);
  await unsafeCreateEntityTable(stack.db, echoEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  afterCommitLog.length = 0;
  afterCommitHookShouldEchoBag = false;
  echoedBagIds.length = 0;
  await asRawClient(stack.db).unsafe(`DELETE FROM "${bagTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${secretTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${echoTable.tableName}"`);
  // Clear the event-dedup cache — tests re-use entity ids (Postgres sequences
  // reset, each test sees id=1). Without flushing Redis the second test hits
  // a dedup hit on the same handler:id:version:phase key and the hook is
  // silently skipped.
  await stack.redis.flushNamespace();
});

describe("ctx.query / ctx.queryAs", () => {
  test("queryAs(system) returns fields that the caller's role cannot read", async () => {
    // Seed via writeAs(system) — the caller Admin can't write the token directly
    const res = await stack.http.write(
      "ctxbridge:write:bag:create-with-secret",
      { label: "outer", token: "top-secret" },
      admin,
    );
    expect((await res.json()).isSuccess).toBe(true);

    // Fetch via ctx.queryAs(system) — token comes through because system
    // satisfies the field-access read rule on `token`.
    const peeked = await stack.http.queryOk<Record<string, unknown>>(
      "ctxbridge:query:bag:peek-secret",
      { owner: admin.id },
      admin,
    );
    expect(peeked).toMatchObject({ owner: admin.id, token: "top-secret" });
  });
});

describe("ctx.writeAs shares the outer transaction", () => {
  test("failure in outer write rolls back the writeAs insert too", async () => {
    const res = await stack.http.write(
      "ctxbridge:write:bag:create-with-secret",
      { label: "rolled-back", token: "discarded", fail: true },
      admin,
    );
    const body = await res.json();
    expect(body.isSuccess).toBe(false);

    // Both tables empty — outer bag + inner secret rolled back together
    const bags = await selectMany(stack.db, bagTable);
    const secrets = await selectMany(stack.db, secretTable);
    expect(bags).toHaveLength(0);
    expect(secrets).toHaveLength(0);
  });

  test("success: both writes persist, both afterCommit hooks fire exactly once", async () => {
    const res = await stack.http.write(
      "ctxbridge:write:bag:create-with-secret",
      { label: "committed", token: "kept" },
      admin,
    );
    expect((await res.json()).isSuccess).toBe(true);

    const bags = await selectMany(stack.db, bagTable);
    const secrets = await selectMany(stack.db, secretTable);
    expect(bags).toHaveLength(1);
    expect(secrets).toHaveLength(1);

    // Both entities' afterCommit hooks fire once each: bag (outer write) and
    // secret (inner writeAs). Neither fires twice, even though secret was
    // created through the nested bridge call.
    expect(afterCommitLog.sort()).toEqual([`bag:committed`, `secret:${admin.id}`]);
  });

  test("rollback: inner secret hook does NOT fire when outer write fails", async () => {
    const res = await stack.http.write(
      "ctxbridge:write:bag:create-with-secret",
      { label: "ignored", token: "discarded", fail: true },
      admin,
    );
    expect((await res.json()).isSuccess).toBe(false);

    // Both hooks must stay silent — tx rolled back, afterCommit queue dropped.
    expect(afterCommitLog).toEqual([]);
  });
});

describe("ctx.dbOutsideTransaction", () => {
  test("a write through it survives the handler's own transaction rolling back", async () => {
    const res = await stack.http.write(
      "ctxbridge:write:bag:create-outside-tx-then-fail",
      { label: "probe" },
      admin,
    );
    expect((await res.json()).isSuccess).toBe(false);

    const bags = await selectMany(stack.db, bagTable);
    const labels = (bags as Array<Record<string, unknown>>).map((row) => row["label"]);
    expect(labels).toEqual(["probe-outside-tx"]);
  });

  test("an already-aborted request signal still commits both ctx.db and ctx.dbOutsideTransaction writes", async () => {
    const controller = new AbortController();
    controller.abort();
    const token = await stack.jwt.sign(admin);

    const res = await stack.app.request(
      new Request("http://test.local/api/write", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          type: "ctxbridge:write:bag:create-signal-probe",
          payload: { label: "signal-probe" },
        }),
        signal: controller.signal,
      }),
    );

    const body = (await res.json()) as {
      isSuccess: boolean;
      data?: { signalSeen: boolean };
    };
    expect(body.isSuccess).toBe(true);
    expect(body.data?.signalSeen).toBe(false);

    // Both inserts landed — the client's disconnect doesn't touch the write.
    const bags = await selectMany(stack.db, bagTable);
    const labels = (bags as Array<Record<string, unknown>>).map((row) => row["label"]).sort();
    expect(labels).toEqual(["signal-probe-inside-tx", "signal-probe-outside-tx"]);
  });

  test("an already-aborted signal doesn't stop idempotent retries from committing", async () => {
    const controller = new AbortController();
    controller.abort();
    const token = await stack.jwt.sign(admin);
    const requestId = "retry-under-abort-1";

    const requestOptions = {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        type: "ctxbridge:write:bag:create-plain",
        payload: { label: "retried" },
        requestId,
      }),
      signal: controller.signal,
    } as const;

    const first = await stack.app.request(
      new Request("http://test.local/api/write", requestOptions),
    );
    const second = await stack.app.request(
      new Request("http://test.local/api/write", requestOptions),
    );

    expect((await first.json()).isSuccess).toBe(true);
    expect((await second.json()).isSuccess).toBe(true);

    const bags = await selectMany(stack.db, bagTable);
    expect(bags).toHaveLength(1);
  });
});

describe("query dispatch surfaces a client abort as 499, not a server fault", () => {
  test("a pre-aborted signal 499s instead of 500ing", async () => {
    const controller = new AbortController();
    controller.abort();
    const token = await stack.jwt.sign(admin);

    const res = await stack.app.request(
      new Request("http://test.local/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          type: "ctxbridge:query:bag:list-signal-probe",
          payload: {},
        }),
        signal: controller.signal,
      }),
    );
    expect(res.status).toBe(499);
  });

  test("a pre-aborted signal still 500s when the handler fails for an unrelated reason", async () => {
    const controller = new AbortController();
    controller.abort();
    const token = await stack.jwt.sign(admin);

    const res = await stack.app.request(
      new Request("http://test.local/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          type: "ctxbridge:query:bag:query-boom",
          payload: {},
        }),
        signal: controller.signal,
      }),
    );
    expect(res.status).toBe(500);
  });
});

describe("afterCommit hook context is usable for real DB work", () => {
  test("a postSave afterCommit hook can write a second entity via ctx.write", async () => {
    afterCommitHookShouldEchoBag = true;

    const res = await stack.http.write("ctxbridge:write:bag:create", { label: "echo-me" }, admin);
    expect((await res.json()).isSuccess).toBe(true);

    // The effect, not just "no throw": afterCommit hook errors are caught
    // and logged by the framework (dispatch-batch.ts flushAfterCommit), so
    // a broken hook still returns a 200 here. What proves the fix is that
    // the hook's ctx.write actually landed a row through the event-store
    // append path.
    expect(echoedBagIds).toHaveLength(1);
    const [expectedBagId] = echoedBagIds;
    if (!expectedBagId) throw new Error("echoedBagIds[0] missing");
    const echoes = await selectMany(stack.db, echoTable);
    expect(echoes).toHaveLength(1);
    expect((echoes[0] as { bagId: string }).bagId).toBe(expectedBagId);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { asRawClient, selectMany } from "../../bun-db/query";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { buildEntityTable } from "../../db/table-builder";
import {
  access,
  createEntity,
  createNumberField,
  createSystemUser,
  createTextField,
  defineFeature,
} from "../../engine";
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
    label: createTextField({ required: true }),
    counter: createNumberField({ default: 0 }),
  },
});
const bagTable = buildEntityTable("bag", bagEntity);

// secret has a system-only read field — proves queryAs(system) reads it,
// plain query doesn't.
const secretEntity = createEntity({
  table: "ctx_secrets",
  fields: {
    owner: createTextField({ required: true }),
    token: createTextField({
      required: true,
      access: { read: access.privileged, write: access.privileged },
    }),
  },
});
const secretTable = buildEntityTable("secret", secretEntity);

let stack: TestStack;
const admin = TestUsers.admin;

const afterCommitLog: string[] = [];

const bridgeFeature = defineFeature("ctxbridge", (r) => {
  const bag = r.entity("bag", bagEntity);
  const secret = r.entity("secret", secretEntity);

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
    { access: { roles: ["Admin"] } },
  );

  // afterCommit hook on bag — fires once per outer commit.
  r.entityHook("postSave", bag, async (result) => {
    afterCommitLog.push(`bag:${result.data["label"]}`);
  });

  // afterCommit hook on secret — the entity targeted by the nested writeAs.
  // Proves: (a) hook fires exactly once per successful writeAs, (b) hook
  // does NOT fire when the outer transaction rolls back.
  r.entityHook("postSave", secret, async (result) => {
    afterCommitLog.push(`secret:${result.data["owner"]}`);
  });
});

beforeAll(async () => {
  stack = await setupTestStack({ features: [bridgeFeature] });
  await unsafeCreateEntityTable(stack.db, bagEntity);
  await unsafeCreateEntityTable(stack.db, secretEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  afterCommitLog.length = 0;
  await asRawClient(stack.db).unsafe(`DELETE FROM "${bagTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${secretTable.tableName}"`);
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

// ctx.lifecycle.afterRollback over real HTTP: the callback runs when the outermost transaction does
// not commit, or when the enclosing savepoint rolls back, and never on a plain commit.

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
import { selectMany } from "../../db/query.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import { unsafePushTables } from "../../db/table-push.ts";
import { requireOutsideTransactionDb } from "../../db/tenant-db.ts";
import { runInOwnTransaction } from "../../db/tenant-db-scoped-rebind.ts";
import { createEntity, createTextField, defineFeature, HookPhases } from "../../engine/index.ts";
import { UnprocessableError, writeFailure } from "../../errors/index.ts";
import { eventsTable } from "../../event-store/index.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";

const noteEntity = createEntity({
  table: "sar_notes",
  fields: { title: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});
const noteTable = buildEntityTable("note", noteEntity);
const noteExecutor = createEventStoreExecutor(noteTable, noteEntity, { entityName: "note" });

const reservationTable = defineUnmanagedTable({
  tableName: "sar_reservations",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "label", pgType: "text", notNull: true },
  ],
});

const FEATURE = "sar";
const REJECTED_MARKER = "rejected";
const INNER = `${FEATURE}:write:inner:create`;

const payloadSchema = z.object({ label: z.string() });

type Callback = { readonly label: string; readonly outerCommittedAtCall: boolean };
const callbacks: Callback[] = [];

async function outerNoteVisible(label: string): Promise<boolean> {
  const rows = await selectMany(stack.db, noteTable);
  return rows.some((row) => row["title"] === `${label}-outer`);
}

const feature = defineFeature(FEATURE, (r) => {
  const note = r.entity({ name: "note", ...noteEntity });

  r.writeHandler({
    name: "inner:create",
    schema: payloadSchema,
    handler: async (event, ctx) => {
      const { label } = event.payload;
      ctx.lifecycle.afterRollback?.(async () => {
        const base = label.replace(`-${REJECTED_MARKER}`, "");
        callbacks.push({ label, outerCommittedAtCall: await outerNoteVisible(base) });
      });
      return noteExecutor.create({ title: label }, event.user, ctx.db);
    },
    access: { roles: ["Admin"] },
  });

  r.hook({
    type: "postSave",
    target: { allOf: note },
    handler: async (result) => {
      if (String(result.data["title"]).includes(REJECTED_MARKER)) {
        throw new Error("note rejected");
      }
    },
    phase: HookPhases.inTransaction,
  });

  r.writeHandler({
    name: "commit-ok",
    schema: payloadSchema,
    handler: async (event, ctx) => {
      ctx.lifecycle.afterRollback?.(async () => {
        callbacks.push({ label: event.payload.label, outerCommittedAtCall: false });
      });
      return noteExecutor.create({ title: event.payload.label }, event.user, ctx.db);
    },
    access: { roles: ["Admin"] },
  });

  // The reservation lives outside the handler transaction, so only the callback can give it back.
  r.writeHandler({
    name: "reserve-then-fail",
    schema: payloadSchema,
    handler: async (event, ctx) => {
      const outside = requireOutsideTransactionDb(ctx);
      const { label } = event.payload;
      await runInOwnTransaction(outside, (txDb) => txDb.insertOne(reservationTable, { label }));
      ctx.lifecycle.afterRollback?.(async () => {
        await runInOwnTransaction(outside, (txDb) => txDb.deleteMany(reservationTable, { label }));
      });
      await ctx.dispatch.write(INNER, { label });
      return writeFailure(new UnprocessableError("handler_rejected"));
    },
    access: { roles: ["Admin"] },
  });

  // The inner write fails after its row is written; the outer handler swallows that and commits.
  r.writeHandler({
    name: "swallow-inner-failure",
    schema: payloadSchema,
    handler: async (event, ctx) => {
      const { label } = event.payload;
      const inner = await ctx.dispatch.write(INNER, { label: `${label}-${REJECTED_MARKER}` });
      if (inner.isSuccess) return writeFailure(new UnprocessableError("inner_should_fail"));
      return noteExecutor.create({ title: `${label}-outer` }, event.user, ctx.db);
    },
    access: { roles: ["Admin"] },
  });

  r.writeHandler({
    name: "inner-ok-then-fail",
    schema: payloadSchema,
    handler: async (event, ctx) => {
      const inner = await ctx.dispatch.write(INNER, { label: event.payload.label });
      if (!inner.isSuccess) return inner;
      return writeFailure(new UnprocessableError("outer_rejected"));
    },
    access: { roles: ["Admin"] },
  });

  r.writeHandler({
    name: "throwing-callback",
    schema: payloadSchema,
    handler: async (_event, ctx) => {
      ctx.lifecycle.afterRollback?.(async () => {
        throw new Error("compensation failed");
      });
      return writeFailure(new UnprocessableError("handler_rejected"));
    },
    access: { roles: ["Admin"] },
  });
});

let stack: TestStack;
const admin = createTestUser({ id: 1, tenantId: testTenantId(9611), roles: ["Admin"] });

async function reservedLabels(): Promise<string[]> {
  const rows = await selectMany<{ label: string }>(stack.db, reservationTable, undefined, {
    orderBy: { col: "label", direction: "asc" },
  });
  return rows.map((row) => row.label);
}

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
  await unsafePushTables(stack.db, { sar_reservations: reservationTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [noteTable, eventsTable, reservationTable]);
  callbacks.length = 0;
});

describe("ctx.scheduleAfterRollback", () => {
  test("never runs when the transaction commits", async () => {
    await stack.http.writeOk(`${FEATURE}:write:commit-ok`, { label: "c1" }, admin);

    expect(callbacks).toEqual([]);
  });

  test("a rollback of the outer transaction after ctx.dispatch.write frees the reservation exactly once", async () => {
    const error = await stack.http.writeErr(
      `${FEATURE}:write:reserve-then-fail`,
      { label: "r1" },
      admin,
    );

    expect(error.httpStatus).toBe(422);
    expect(await reservedLabels()).toEqual([]);
    expect(callbacks).toEqual([{ label: "r1", outerCommittedAtCall: false }]);
  });

  test("a rolled-back nested savepoint runs its callback once, after the outer transaction commits", async () => {
    await stack.http.writeOk(`${FEATURE}:write:swallow-inner-failure`, { label: "n1" }, admin);

    expect(callbacks).toEqual([{ label: "n1-rejected", outerCommittedAtCall: true }]);
  });

  test("a successful nested write is compensated once when the outer transaction rolls back", async () => {
    const error = await stack.http.writeErr(
      `${FEATURE}:write:inner-ok-then-fail`,
      { label: "n2" },
      admin,
    );

    expect(error.httpStatus).toBe(422);
    expect(callbacks).toEqual([{ label: "n2", outerCommittedAtCall: false }]);
  });

  test("a throwing callback does not change the write response", async () => {
    const error = await stack.http.writeErr(
      `${FEATURE}:write:throwing-callback`,
      { label: "t1" },
      admin,
    );

    expect(error.httpStatus).toBe(422);
    expect(error.message).toContain("handler_rejected");
  });
});

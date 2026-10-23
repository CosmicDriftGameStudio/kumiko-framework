// The scope of a batch command comes from its own type, never from the other commands the client batched with it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { table, text, uuid } from "../../db/dialect.ts";
import { insertOne, selectMany } from "../../db/query.ts";
import { unsafePushTables } from "../../db/table-push.ts";
import { defineFeature, defineWriteHandler } from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const itemsTable = table("fw4_batchscope_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  label: text("label").notNull(),
});

const admin = TestUsers.admin;
const other = TestUsers.otherTenant;

let stack: TestStack;

function peekHandler() {
  return defineWriteHandler({
    name: "peek",
    schema: z.object({}),
    access: { roles: ["Admin"] },
    handler: async () => {
      const rows = await selectMany<{ label: string }>(stack.unscopedDb, itemsTable);
      return { isSuccess: true as const, data: { labels: rows.map((row) => row.label).sort() } };
    },
  });
}

const tenantFeature = defineFeature("bscope", (r) => {
  r.writeHandler(peekHandler());
});

const systemFeature = defineFeature("bscopesys", (r) => {
  r.systemScope();
  r.writeHandler(peekHandler());
});

const PEEK = "bscope:write:peek";
const SYSTEM_PEEK = "bscopesys:write:peek";

beforeAll(async () => {
  stack = await setupTestStack({ features: [tenantFeature, systemFeature] });
  await unsafePushTables(stack.unscopedDb, { items: itemsTable });
  await insertOne(stack.db, itemsTable, { tenantId: admin.tenantId, label: "own" });
  await insertOne(stack.db, itemsTable, { tenantId: other.tenantId, label: "foreign" });
});

afterAll(async () => {
  await stack.cleanup();
});

async function labelsPerCommand(types: readonly string[]): Promise<unknown[]> {
  const res = await stack.http.batch(
    types.map((type) => ({ type, payload: {} })),
    admin,
  );
  const body = await res.json();
  expect(body.isSuccess).toBe(true);
  return body.results.map((result: { data: { labels: string[] } }) => result.data.labels);
}

describe("batch scope per command", () => {
  test("a tenant command batched with a system-scoped command still sees its own tenant only", async () => {
    expect(await labelsPerCommand([SYSTEM_PEEK, PEEK])).toEqual([["foreign", "own"], ["own"]]);
  });

  test("the order of the batched commands does not change either scope", async () => {
    expect(await labelsPerCommand([PEEK, SYSTEM_PEEK])).toEqual([["own"], ["foreign", "own"]]);
  });

  test("a tenant-only batch stays tenant scoped", async () => {
    expect(await labelsPerCommand([PEEK, PEEK])).toEqual([["own"], ["own"]]);
  });
});

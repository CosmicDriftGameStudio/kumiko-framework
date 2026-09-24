// fw#2855 — a write handler's `escapeHatch` gates writes through ctx.db.global(table):
// WITH it the write succeeds, WITHOUT it the same handler rejects with access_denied.
// Real HTTP calls + setupTestStack — never createTestDispatcher.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineUnmanagedTable } from "../../db/entity-table-meta";
import { defineFeature } from "../../engine";
import { createTestUser, setupTestStack, type TestStack } from "../../stack";

const globalStoreTable = defineUnmanagedTable({
  tableName: "store_fw2855_escape_hatch_items",
  tenancy: "global",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "note", pgType: "text", notNull: true },
  ],
});

const escapeHatchFeature = defineFeature("escape-hatch-probe", (r) => {
  r.storeTable(globalStoreTable, {
    reason: "fw#2855 integration test — cross-tenant store table for db.global()",
  });

  r.writeHandler({
    name: "write-with-hatch",
    schema: z.object({ note: z.string() }),
    access: { roles: ["User"] },
    escapeHatch: { reason: "fw#2855 integration test — declared cross-tenant write" },
    handler: async (event, ctx) => {
      const row = await ctx.db.global(globalStoreTable).insertOne<{ id: string }>({
        note: event.payload.note,
      });
      return { isSuccess: true as const, data: row };
    },
  });

  r.writeHandler({
    name: "write-without-hatch",
    schema: z.object({ note: z.string() }),
    access: { roles: ["User"] },
    handler: async (event, ctx) => {
      const row = await ctx.db.global(globalStoreTable).insertOne<{ id: string }>({
        note: event.payload.note,
      });
      return { isSuccess: true as const, data: row };
    },
  });
});

let stack: TestStack;
const user = createTestUser({
  id: 91,
  tenantId: "11111111-0000-4000-8000-000000000091",
  roles: ["User"],
});

beforeAll(async () => {
  stack = await setupTestStack({ features: [escapeHatchFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("write handler escapeHatch gates ctx.db.global() writes", () => {
  test("WITH escapeHatch: the write succeeds", async () => {
    const result = await stack.http.writeOk<{ id: string }>(
      "escape-hatch-probe:write:write-with-hatch",
      { note: "hi" },
      user,
    );
    expect(result.id).toBeDefined();
  });

  test("WITHOUT escapeHatch: the same write shape fails with access_denied", async () => {
    const err = await stack.http.writeErr(
      "escape-hatch-probe:write:write-without-hatch",
      { note: "hi" },
      user,
    );
    expect(err.code).toBe("access_denied");
  });
});

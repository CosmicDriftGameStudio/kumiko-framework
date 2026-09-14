// fw#2858 — userEntity carries `tenancy: "global"` (a person's platform-wide
// identity, shared across tenants). Reads through ctx.db.global(userTable)
// work cross-tenant with no escapeHatch; a write attempt through the same
// accessor is denied without one — userTable stays managed (executor-only),
// so a hand-written write bypassing the executor must still be gated.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { z } from "zod";
import { UserHandlers } from "../constants";
import { createUserFeature } from "../feature";
import { userEntity, userTable } from "../schema/user";

const globalUserAccessFeature = defineFeature("user-global-access-probe", (r) => {
  r.queryHandler({
    name: "read-via-global",
    schema: z.object({ id: z.string() }),
    access: { roles: ["User"] },
    handler: async (query, ctx) => {
      const row = await ctx.db
        .global(userTable)
        .fetchOne<{ id: string; email: string }>({ id: query.payload.id });
      return row ?? null;
    },
  });

  r.writeHandler({
    name: "write-via-global-without-hatch",
    schema: z.object({}),
    access: { roles: ["User"] },
    handler: async (_event, ctx) => {
      const accessor = ctx.db.global(userTable);
      // @ts-expect-error executor-only brand — userTable's managed write methods
      // are type-hidden through db.global(); the runtime object still carries
      // them, so the escapeHatch gate below is the actual enforcement.
      const row = await accessor.insertOne({ displayName: "hack", email: "hack@example.com" });
      return { isSuccess: true as const, data: row };
    },
  });
});

let stack: TestStack;
const systemAdmin = TestUsers.systemAdmin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createUserFeature(), globalUserAccessFeature] });
  await unsafeCreateEntityTable(stack.db, userEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("ctx.db.global(userTable) — cross-tenant identity access (fw#2858)", () => {
  test("a handler in tenant A reads the user via db.global(userTable).fetchOne", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      { email: "global-read@example.com", displayName: "Global Read", passwordHash: "seeded-hash" },
      systemAdmin,
    );

    const readerInTenantA = createTestUser({
      id: crypto.randomUUID(),
      tenantId: "11111111-0000-4000-8000-0000000000a1",
      roles: ["User"],
    });
    const row = await stack.http.queryOk<{ id: string; email: string } | null>(
      "user-global-access-probe:query:read-via-global",
      { id: created.id },
      readerInTenantA,
    );

    expect(row?.id).toBe(created.id);
    expect(row?.email).toBe("global-read@example.com");
  });

  test("a write attempt through ctx.db.global(userTable) without escapeHatch fails with access_denied", async () => {
    const writer = createTestUser({
      id: crypto.randomUUID(),
      tenantId: "11111111-0000-4000-8000-0000000000a2",
      roles: ["User"],
    });
    const err = await stack.http.writeErr(
      "user-global-access-probe:write:write-via-global-without-hatch",
      {},
      writer,
    );
    expect(err.code).toBe("access_denied");
  });
});

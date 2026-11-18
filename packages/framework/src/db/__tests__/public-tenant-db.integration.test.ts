// The public createTenantDb builds tenant-mode handles only, and neither it nor
// scopeTenantDbToTenant can be used to move a handle to another tenant.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { defineFeature, parseTenantId } from "../../engine/index.ts";
import { UnprocessableError } from "../../errors/index.ts";
import { TestUsers, testTenantId } from "../../seeding/seed-users.ts";
import { createTenantDb, scopeTenantDbToTenant, transaction } from "../index.ts";
import { runInSavepoint } from "../query.ts";

const tenantPayload = z.object({ tenantId: z.string() });
const anyUser = { openToAll: { reason: "test handler callable by any signed-in test user" } };

function tenantIdOrThrow(raw: string) {
  const parsed = parseTenantId(raw);
  if (!parsed) throw new UnprocessableError("invalid_tenant_id");
  return parsed;
}

const pubdbFeature = defineFeature("pubdb", (r) => {
  r.queryHandler({
    name: "raw-retenant",
    schema: tenantPayload,
    access: anyUser,
    escapeHatch: {
      grants: ["unsafeRaw"],
      reason: "test: public createTenantDb refuses an unsafeRaw runner",
    },
    handler: async ({ payload }, ctx) => {
      createTenantDb({
        db: ctx.db.unsafeRawAllTenants(),
        tenantId: tenantIdOrThrow(payload.tenantId),
      });
      return { ok: true };
    },
  });

  r.queryHandler({
    name: "raw-transaction-retenant",
    schema: tenantPayload,
    access: anyUser,
    escapeHatch: {
      grants: ["unsafeRaw"],
      reason: "test: a transaction opened on an unsafeRaw runner stays unsafeRaw",
    },
    handler: async ({ payload }, ctx) => {
      await transaction(ctx.db.unsafeRawAllTenants(), async (tx) => {
        createTenantDb({ db: tx, tenantId: tenantIdOrThrow(payload.tenantId) });
      });
      return { ok: true };
    },
  });

  r.writeHandler({
    name: "raw-savepoint-retenant",
    schema: tenantPayload,
    access: anyUser,
    escapeHatch: {
      grants: ["unsafeRaw"],
      reason: "test: a savepoint opened on an unsafeRaw runner stays unsafeRaw",
    },
    handler: async ({ payload }, ctx) => {
      await runInSavepoint(ctx.db.unsafeRawAllTenants(), async (sp) => {
        createTenantDb({ db: sp, tenantId: tenantIdOrThrow(payload.tenantId) });
      });
      return { isSuccess: true as const, data: { ok: true } };
    },
  });

  r.queryHandler({
    name: "scope-foreign",
    schema: tenantPayload,
    access: anyUser,
    handler: async ({ payload }, ctx) => {
      scopeTenantDbToTenant(ctx.db, tenantIdOrThrow(payload.tenantId));
      return { ok: true };
    },
  });

  r.queryHandler({
    name: "scope-own",
    schema: tenantPayload,
    access: anyUser,
    handler: async (query, ctx) => {
      scopeTenantDbToTenant(ctx.db, query.user.tenantId);
      return { ok: true };
    },
  });
});

const pubdbSystemFeature = defineFeature("pubdbsys", (r) => {
  r.systemScope();
  r.queryHandler({
    name: "system-raw-retenant",
    schema: tenantPayload,
    access: anyUser,
    handler: async ({ payload }, ctx) => {
      if (!ctx.systemDb) throw new Error("systemScope handler without ctx.systemDb");
      createTenantDb({
        db: ctx.systemDb.unsafeRaw(
          "test: public createTenantDb refuses a systemDb unsafeRaw runner",
        ),
        tenantId: tenantIdOrThrow(payload.tenantId),
      });
      return { ok: true };
    },
  });
});

let stack: TestStack;
const admin = TestUsers.admin;
const own = testTenantId(1);
const other = testTenantId(2);

beforeAll(async () => {
  stack = await setupTestStack({
    features: [pubdbFeature, pubdbSystemFeature],
    systemHooks: [],
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("public tenant db", () => {
  test("public createTenantDb refuses a runner from unsafeRaw()", async () => {
    const error = await stack.http.queryErr("pubdb:query:raw-retenant", { tenantId: other }, admin);
    expect(error.httpStatus).toBe(403);
  });

  test("public createTenantDb refuses a transaction opened on an unsafeRaw runner", async () => {
    const error = await stack.http.queryErr(
      "pubdb:query:raw-transaction-retenant",
      { tenantId: other },
      admin,
    );
    expect(error.httpStatus).toBe(403);
  });

  test("public createTenantDb refuses a savepoint opened on an unsafeRaw runner", async () => {
    const error = await stack.http.writeErr(
      "pubdb:write:raw-savepoint-retenant",
      { tenantId: other },
      admin,
    );
    expect(error.httpStatus).toBe(403);
  });

  test("public createTenantDb refuses a runner from ctx.systemDb.unsafeRaw()", async () => {
    const error = await stack.http.queryErr(
      "pubdbsys:query:system-raw-retenant",
      { tenantId: other },
      admin,
    );
    expect(error.httpStatus).toBe(403);
  });

  test("scopeTenantDbToTenant refuses moving a tenant handle to another tenant", async () => {
    const error = await stack.http.queryErr(
      "pubdb:query:scope-foreign",
      { tenantId: other },
      admin,
    );
    expect(error.httpStatus).toBe(403);
  });

  test("scopeTenantDbToTenant narrows a tenant handle to its own tenant", async () => {
    const result = await stack.http.queryOk("pubdb:query:scope-own", { tenantId: own }, admin);
    expect(result).toEqual({ ok: true });
  });
});

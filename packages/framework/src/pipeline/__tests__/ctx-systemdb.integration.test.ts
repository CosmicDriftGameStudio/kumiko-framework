import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineFeature } from "../../engine";
import { setupTestStack, type TestStack, TestUsers } from "../../stack";

// r.systemScope() is feature-level (define-feature.ts), not per-handler — so
// two features prove both sides: one system-scoped, one not.

const systemScopedFeature = defineFeature("ctxsystemdb-system", (r) => {
  r.systemScope();

  r.queryHandler(
    "check",
    z.object({}),
    async (query, ctx) => {
      if (!ctx.systemDb) return { present: false as const };
      // assertTenantMatch returns the underlying TenantDb — proves systemDb
      // is bound to the SAME internally-built TenantDb as ctx.db, not a
      // separate instance (dispatch-shared.ts builds `as HandlerContext`,
      // so a mis-wired property wouldn't be caught by tsc).
      const checked = ctx.systemDb.assertTenantMatch(query.user.tenantId);
      return { present: true as const, boundToDb: checked === ctx.db };
    },
    { access: { roles: ["Admin"] } },
  );
});

const tenantScopedFeature = defineFeature("ctxsystemdb-tenant", (r) => {
  r.queryHandler(
    "check",
    z.object({}),
    async (_query, ctx) => ({ present: ctx.systemDb !== undefined }),
    { access: { roles: ["Admin"] } },
  );
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [systemScopedFeature, tenantScopedFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("ctx.systemDb", () => {
  test("is present and bound to ctx.db for r.systemScope() handlers", async () => {
    const result = await stack.http.queryOk<{ present: boolean; boundToDb: boolean }>(
      "ctxsystemdb-system:query:check",
      {},
      admin,
    );
    expect(result.present).toBe(true);
    expect(result.boundToDb).toBe(true);
  });

  test("is absent for non-system-scoped handlers", async () => {
    const result = await stack.http.queryOk<{ present: boolean }>(
      "ctxsystemdb-tenant:query:check",
      {},
      admin,
    );
    expect(result.present).toBe(false);
  });
});

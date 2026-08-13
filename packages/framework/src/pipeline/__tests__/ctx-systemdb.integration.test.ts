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
      if (!ctx.systemDb)
        return { present: false as const, tenantIdMatches: false, dbThrows: false };
      // ctx.db is fail-closed for r.systemScope() handlers — dispatch-shared.ts
      // builds `as HandlerContext`, so a mis-wired property wouldn't be caught
      // by tsc. Prove it at runtime: assertTenantMatch must hand back a
      // working, correctly-scoped TenantDb, and touching ctx.db itself must
      // throw instead of silently returning an unfiltered db.
      const checked = ctx.systemDb.assertTenantMatch(query.user.tenantId);
      let dbThrows = false;
      try {
        void ctx.db.tenantId;
      } catch {
        dbThrows = true;
      }
      return {
        present: true as const,
        tenantIdMatches: checked.tenantId === query.user.tenantId,
        dbThrows,
      };
    },
    { access: { roles: ["Admin"] } },
  );
});

const tenantScopedFeature = defineFeature("ctxsystemdb-tenant", (r) => {
  r.queryHandler(
    "check",
    z.object({}),
    async (query, ctx) => ({
      present: ctx.systemDb !== undefined,
      dbWorks: ctx.db.tenantId === query.user.tenantId,
    }),
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
  test("is present for r.systemScope() handlers; ctx.db is fail-closed there", async () => {
    const result = await stack.http.queryOk<{
      present: boolean;
      tenantIdMatches: boolean;
      dbThrows: boolean;
    }>("ctxsystemdb-system:query:check", {}, admin);
    expect(result.present).toBe(true);
    expect(result.tenantIdMatches).toBe(true);
    expect(result.dbThrows).toBe(true);
  });

  test("is absent for non-system-scoped handlers; ctx.db works normally there", async () => {
    const result = await stack.http.queryOk<{ present: boolean; dbWorks: boolean }>(
      "ctxsystemdb-tenant:query:check",
      {},
      admin,
    );
    expect(result.present).toBe(false);
    expect(result.dbWorks).toBe(true);
  });
});

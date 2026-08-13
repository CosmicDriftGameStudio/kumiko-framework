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
        return {
          present: false as const,
          tenantIdMatches: false,
          dbThrows: false,
          dbOutsideTransactionPresent: false,
          dbOutsideTransactionThrows: false,
          outsideTransactionTenantIdMatches: false,
        };
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
      // Same fail-closed proof for ctx.dbOutsideTransaction — the second,
      // previously-unguarded door #2118 closes. Its guarded escape hatch is
      // ctx.systemDb.outsideTransaction, not ctx.systemDb itself. The guard
      // is a Proxy (truthy), so `?.` here would mask the two regressions
      // this test needs to tell apart: "field silently undefined" vs. "field
      // holds a working, unfiltered db" both look identical under `?.`.
      // Check presence without touching a proxy property (`!==` on the field
      // itself doesn't trap), then force the property read separately.
      const dbOutsideTransactionPresent = ctx.dbOutsideTransaction !== undefined;
      let dbOutsideTransactionThrows = false;
      try {
        void ctx.dbOutsideTransaction!.tenantId;
      } catch {
        dbOutsideTransactionThrows = true;
      }
      const checkedOutsideTx = ctx.systemDb.outsideTransaction.assertTenantMatch(
        query.user.tenantId,
      );
      return {
        present: true as const,
        tenantIdMatches: checked.tenantId === query.user.tenantId,
        dbThrows,
        dbOutsideTransactionPresent,
        dbOutsideTransactionThrows,
        outsideTransactionTenantIdMatches: checkedOutsideTx.tenantId === query.user.tenantId,
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
      dbOutsideTransactionWorks: ctx.dbOutsideTransaction?.tenantId === query.user.tenantId,
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
  test("is present for r.systemScope() handlers; ctx.db and ctx.dbOutsideTransaction are both fail-closed there", async () => {
    const result = await stack.http.queryOk<{
      present: boolean;
      tenantIdMatches: boolean;
      dbThrows: boolean;
      dbOutsideTransactionPresent: boolean;
      dbOutsideTransactionThrows: boolean;
      outsideTransactionTenantIdMatches: boolean;
    }>("ctxsystemdb-system:query:check", {}, admin);
    expect(result.present).toBe(true);
    expect(result.tenantIdMatches).toBe(true);
    expect(result.dbThrows).toBe(true);
    expect(result.dbOutsideTransactionPresent).toBe(true);
    expect(result.dbOutsideTransactionThrows).toBe(true);
    expect(result.outsideTransactionTenantIdMatches).toBe(true);
  });

  test("is absent for non-system-scoped handlers; ctx.db and ctx.dbOutsideTransaction work normally there", async () => {
    const result = await stack.http.queryOk<{
      present: boolean;
      dbWorks: boolean;
      dbOutsideTransactionWorks: boolean;
    }>("ctxsystemdb-tenant:query:check", {}, admin);
    expect(result.present).toBe(false);
    expect(result.dbWorks).toBe(true);
    expect(result.dbOutsideTransactionWorks).toBe(true);
  });
});

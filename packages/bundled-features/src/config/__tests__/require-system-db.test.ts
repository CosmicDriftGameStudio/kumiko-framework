import { describe, expect, test } from "bun:test";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createUncheckedSystemDb } from "@cosmicdrift/kumiko-framework/db";
import type { HandlerContext, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError } from "@cosmicdrift/kumiko-framework/errors";
import { requireSystemDb } from "../feature";

// Minimal TenantDb stub — only .tenantId is read by assertTenantMatch /
// createUncheckedSystemDb; the real db-query methods are never called by
// requireSystemDb itself.
function fakeTenantDb(tenantId: TenantId): TenantDb {
  return { tenantId, mode: "system" } as unknown as TenantDb;
}

// Minimal HandlerContext stub — only .db / .systemDb are read by requireSystemDb.
function contextStub(db: TenantDb, withSystemDb: boolean): HandlerContext {
  return {
    db,
    systemDb: withSystemDb ? createUncheckedSystemDb(db) : undefined,
    // biome-ignore lint/suspicious/noExplicitAny: rest of HandlerContext isn't touched by requireSystemDb.
  } as any;
}

const TENANT_A = "tenant-a" as TenantId;
const TENANT_B = "tenant-b" as TenantId;

describe("requireSystemDb", () => {
  test("throws InternalError when ctx.systemDb is missing", () => {
    const ctx = contextStub(fakeTenantDb(TENANT_A), false);
    expect(() => requireSystemDb(ctx, "config:query:test", TENANT_A)).toThrow(
      /ctx\.systemDb missing/,
    );
  });

  test("returns the underlying TenantDb when tenantId matches", () => {
    const db = fakeTenantDb(TENANT_A);
    const ctx = contextStub(db, true);
    expect(requireSystemDb(ctx, "config:query:test", TENANT_A)).toBe(db);
  });

  test("fails closed with AccessDeniedError when tenantId does not match ctx.db's own tenant", () => {
    const db = fakeTenantDb(TENANT_A);
    const ctx = contextStub(db, true);
    expect(() => requireSystemDb(ctx, "config:query:test", TENANT_B)).toThrow(AccessDeniedError);
  });
});

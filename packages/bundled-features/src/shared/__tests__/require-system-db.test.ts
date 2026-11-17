import { describe, expect, test } from "bun:test";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createSystemDbView, requireSystemDb } from "@cosmicdrift/kumiko-framework/db";
import type { AppContext, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError, InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { acknowledgedSystemDb } from "../acknowledged-system-db.ts";

// Only .tenantId is read by assertTenantMatch / createSystemDbView.
function fakeTenantDb(tenantId: TenantId): TenantDb {
  return { tenantId, mode: "system" } as unknown as TenantDb;
}

const TENANT_A = "tenant-a" as TenantId;
const TENANT_B = "tenant-b" as TenantId;

describe("requireSystemDb", () => {
  test("throws InternalError naming the caller when ctx.systemDb is missing", () => {
    const ctx: Pick<AppContext, "systemDb"> = {};
    expect(() => requireSystemDb(ctx, "config:query:test")).toThrow(InternalError);
    expect(() => requireSystemDb(ctx, "config:query:test")).toThrow(/config:query:test/);
  });

  test("returns the underlying TenantDb when tenantId matches", () => {
    const db = fakeTenantDb(TENANT_A);
    const ctx: Pick<AppContext, "systemDb"> = { systemDb: createSystemDbView(db) };
    expect(requireSystemDb(ctx, "x").assertTenantMatch(TENANT_A)).toBe(db);
  });

  test("fails closed with AccessDeniedError when tenantId does not match the db's tenant", () => {
    const ctx: Pick<AppContext, "systemDb"> = {
      systemDb: createSystemDbView(fakeTenantDb(TENANT_A)),
    };
    expect(() => requireSystemDb(ctx, "x").assertTenantMatch(TENANT_B)).toThrow(AccessDeniedError);
  });
});

describe("acknowledgedSystemDb", () => {
  test("throws InternalError when ctx.systemDb is missing", () => {
    expect(() => acknowledgedSystemDb({}, "feat", "cross-tenant test read")).toThrow(InternalError);
  });
});

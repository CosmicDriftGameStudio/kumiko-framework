// computeActiveRoles — the client-side merge must be byte-identical to the server-side merge in
// auth-routes.ts (switch-tenant) + login.write.ts. Otherwise, the client sees different roles than
// the server, causing role-gating to diverge (the UI may show something that is not allowed, or
// hide something that is).

import { describe, expect, test } from "bun:test";
import type { CurrentUserProfile, TenantSummary } from "../auth-client.ts";
import { computeActiveRoles } from "../session.tsx";

const user = (globalRoles: readonly string[]): CurrentUserProfile => ({
  id: "u1",
  email: "u@e.com",
  displayName: "U",
  globalRoles,
});

const t = (id: string, roles: readonly string[]): TenantSummary => ({ tenantId: id, roles });

describe("computeActiveRoles", () => {
  test("user=null → []", () => {
    expect(computeActiveRoles(null, "tenant-1", [t("tenant-1", ["Admin"])])).toEqual([]);
  });

  test("globalRoles + active tenant membership → merged + dedupe", () => {
    const result = computeActiveRoles(user(["SystemAdmin"]), "tenant-1", [
      t("tenant-1", ["Admin"]),
    ]);
    expect([...result].sort()).toEqual(["Admin", "SystemAdmin"]);
  });

  test("dedupe: gleiche Rolle in global + membership → einmal", () => {
    const result = computeActiveRoles(user(["Admin", "SystemAdmin"]), "tenant-1", [
      t("tenant-1", ["Admin", "User"]),
    ]);
    expect([...result].sort()).toEqual(["Admin", "SystemAdmin", "User"]);
  });

  test("kein activeTenantId → nur globalRoles", () => {
    const result = computeActiveRoles(user(["SystemAdmin"]), null, [t("tenant-1", ["Admin"])]);
    expect(result).toEqual(["SystemAdmin"]);
  });

  test("activeTenantId zeigt auf nicht-vorhandenen tenant → nur globalRoles", () => {
    const result = computeActiveRoles(user(["SystemAdmin"]), "tenant-2", [
      t("tenant-1", ["Admin"]),
    ]);
    expect(result).toEqual(["SystemAdmin"]);
  });

  test("OHNE globalRoles + active membership → nur membership-roles", () => {
    const result = computeActiveRoles(user([]), "tenant-1", [t("tenant-1", ["Admin"])]);
    expect(result).toEqual(["Admin"]);
  });
});

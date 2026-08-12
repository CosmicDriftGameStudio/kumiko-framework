// groupStaleDraftIdsByTenant — the raw-SQL cross-tenant DELETE it replaced
// (deleteDraftsByIds) never distinguished tenants; formDraftExecutor.delete
// needs a tenant-scoped db + a per-tenant SessionUser, so this grouping is
// the load-bearing step between "batch of stale rows across N tenants" and
// "N per-tenant delete loops". Pure logic, no DB — DB-gated coverage of the
// actual delete path lives in __tests__/cleanup.integration.test.ts.

import { describe, expect, test } from "bun:test";
import { testTenantId } from "@cosmicdrift/kumiko-framework/stack";
import { Temporal } from "temporal-polyfill";
import type { StaleDraftRow } from "../../db/queries/cleanup";
import { groupStaleDraftIdsByTenant } from "../cleanup.job";

const TENANT_A = testTenantId(101);
const TENANT_B = testTenantId(102);

function row(id: string, tenantId = TENANT_A): StaleDraftRow {
  return {
    id,
    tenantId,
    ownerId: "owner-1",
    draft: { values: {}, stepIndex: 0, savedAt: "" },
    insertedAt: Temporal.Instant.fromEpochMilliseconds(0),
  };
}

describe("groupStaleDraftIdsByTenant", () => {
  test("groups ids under their own tenant, preserves per-tenant order", () => {
    const batch = [
      row("id-a1", TENANT_A),
      row("id-b1", TENANT_B),
      row("id-a2", TENANT_A),
      row("id-b2", TENANT_B),
    ];

    const grouped = groupStaleDraftIdsByTenant(batch);

    expect(grouped.size).toBe(2);
    expect(grouped.get(TENANT_A)).toEqual(["id-a1", "id-a2"]);
    expect(grouped.get(TENANT_B)).toEqual(["id-b1", "id-b2"]);
  });

  test("a single-tenant batch produces exactly one group", () => {
    const batch = [row("id-1"), row("id-2"), row("id-3")];

    const grouped = groupStaleDraftIdsByTenant(batch);

    expect(grouped.size).toBe(1);
    expect(grouped.get(TENANT_A)).toEqual(["id-1", "id-2", "id-3"]);
  });

  test("an empty batch produces an empty map", () => {
    expect(groupStaleDraftIdsByTenant([]).size).toBe(0);
  });
});

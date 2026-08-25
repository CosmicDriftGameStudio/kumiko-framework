import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  defineEntityListHandler,
  type HandlerContext,
} from "@cosmicdrift/kumiko-framework/engine";
// kumiko-lint-ignore cross-feature-import SystemAdmin user-list shows membership
// tenants; membership + tenant tables are owned by the tenant feature.
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantTable } from "../../tenant/schema/tenant";
import { userEntity } from "../schema/user";

const baseList = defineEntityListHandler("user", userEntity, {
  access: { roles: access.systemAdmin },
});

async function attachTenantLabels(
  rows: readonly Record<string, unknown>[],
  db: TenantDb,
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return [];
  const userIds = rows.map((r) => String(r["id"] ?? "")).filter((id) => id !== "");
  if (userIds.length === 0) return [...rows];

  let memberships: readonly { userId: unknown; tenantId: unknown }[];
  try {
    memberships = await selectMany<{ userId: unknown; tenantId: unknown }>(
      db,
      tenantMembershipsTable,
      { userId: { in: userIds } },
    );
  } catch (err) {
    // User-only test stacks (and mid-migration DBs) may lack membership tables.
    // List must still work — tenants column falls back to em-dash.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("does not exist") || msg.includes("42P01")) {
      return rows.map((row) => ({ ...row, tenants: "—" }));
    }
    throw err;
  }
  const tenantIds = [
    ...new Set(memberships.map((m) => String(m.tenantId ?? "")).filter((id) => id !== "")),
  ];
  const tenants =
    tenantIds.length > 0
      ? await selectMany<{ id: unknown; name?: unknown; key?: unknown }>(db, tenantTable, {
          id: { in: tenantIds },
        })
      : [];
  const labelByTenantId = new Map<string, string>();
  for (const t of tenants) {
    const id = String(t.id ?? "");
    const label = String(t.name ?? t.key ?? id);
    if (id !== "") labelByTenantId.set(id, label);
  }
  const labelsByUser = new Map<string, string[]>();
  for (const m of memberships) {
    const userId = String(m.userId ?? "");
    const tenantId = String(m.tenantId ?? "");
    if (userId === "" || tenantId === "") continue;
    const label = labelByTenantId.get(tenantId) ?? tenantId;
    const list = labelsByUser.get(userId) ?? [];
    list.push(label);
    labelsByUser.set(userId, list);
  }
  return rows.map((row) => {
    const id = String(row["id"] ?? "");
    const labels = labelsByUser.get(id) ?? [];
    return { ...row, tenants: labels.length > 0 ? labels.join(", ") : "—" };
  });
}

function dbForList(ctx: HandlerContext): TenantDb {
  if (!ctx.systemDb) {
    throw new Error("user:list requires r.systemScope() / ctx.systemDb");
  }
  return ctx.systemDb.acknowledgeCrossTenant(
    "user identity list is cross-tenant; tenants column joins memberships",
  );
}

// System-wide user listing is SystemAdmin-only. Tenant admins list their
// members via the tenant feature (which scopes by membership, not globally).
// Wraps the entity-convention list so each row carries a `tenants` label
// (derived field) — without it the platform roster is unusable for ops.
export const listQuery = {
  ...baseList,
  handler: async (
    query: Parameters<NonNullable<typeof baseList.handler>>[0],
    ctx: HandlerContext,
  ) => {
    const result = await baseList.handler!(query, ctx);
    if (result === null || typeof result !== "object" || !("rows" in result)) {
      return result;
    }
    const envelope = result as { rows: readonly Record<string, unknown>[] };
    const rows = await attachTenantLabels(envelope.rows, dbForList(ctx));
    return { ...envelope, rows };
  },
};

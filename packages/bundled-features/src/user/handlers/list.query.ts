import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  defineEntityListHandler,
  type HandlerContext,
} from "@cosmicdrift/kumiko-framework/engine";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import type { QueryHandlerDef } from "@cosmicdrift/kumiko-types/handlers";
// kumiko-lint-ignore cross-feature-import SystemAdmin user-list joins memberships for tenants column
import { tenantMembershipsTable, tenantTable } from "../../tenant";
import { userEntity } from "../schema/user";

const baseList = defineEntityListHandler("user", userEntity, {
  access: { roles: access.systemAdmin },
});

type MembershipRow = { userId: unknown; tenantId: unknown; roles?: unknown };
type TenantRow = { id: unknown; name?: unknown; key?: unknown };

async function loadMemberships(
  db: TenantDb,
  userIds: readonly string[],
): Promise<readonly MembershipRow[]> {
  // Membership tables ship with the tenant feature; user:list is SystemAdmin
  // roster code that always mounts both. Do not swallow missing-relation
  // errors here — that hid real schema bugs behind a permanent "—" column.
  return await selectMany<MembershipRow>(db, tenantMembershipsTable, {
    userId: { in: [...userIds] },
  });
}

function tenantLabelById(tenants: readonly TenantRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of tenants) {
    const id = String(t.id ?? "");
    if (id === "") continue;
    map.set(id, String(t.name ?? t.key ?? id));
  }
  return map;
}

/** "Offlot Demo (TenantAdmin)" — membership roles live here, not on user.roles. */
function membershipLabel(tenantLabel: string, membershipRoles: readonly string[]): string {
  if (membershipRoles.length === 0) return tenantLabel;
  return `${tenantLabel} (${membershipRoles.join("+")})`;
}

function labelsByUserId(
  memberships: readonly MembershipRow[],
  labelByTenantId: Map<string, string>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const m of memberships) {
    const userId = String(m.userId ?? "");
    const tenantId = String(m.tenantId ?? "");
    if (userId === "" || tenantId === "") continue;
    const tenantLabel = labelByTenantId.get(tenantId) ?? tenantId;
    const label = membershipLabel(tenantLabel, parseRoles(m.roles ?? null));
    const list = map.get(userId) ?? [];
    list.push(label);
    map.set(userId, list);
  }
  return map;
}

export async function attachTenantLabels(
  rows: readonly Record<string, unknown>[],
  db: TenantDb,
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return [];
  const userIds = rows.map((r) => String(r["id"] ?? "")).filter((id) => id !== "");
  if (userIds.length === 0) return [...rows];

  const memberships = await loadMemberships(db, userIds);

  const tenantIds = [
    ...new Set(memberships.map((m) => String(m.tenantId ?? "")).filter((id) => id !== "")),
  ];
  const tenants =
    tenantIds.length > 0
      ? await selectMany<TenantRow>(db, tenantTable, { id: { in: tenantIds } })
      : [];
  const byUser = labelsByUserId(memberships, tenantLabelById(tenants));
  return rows.map((row) => {
    const labels = byUser.get(String(row["id"] ?? "")) ?? [];
    const sorted = [...labels].sort((a, b) => a.localeCompare(b));
    return { ...row, tenants: sorted.length > 0 ? sorted.join(", ") : "" };
  });
}

export function dbForList(ctx: HandlerContext): TenantDb {
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
export const listQuery: QueryHandlerDef = {
  ...baseList,
  handler: async (query, ctx) => {
    const baseHandler = baseList.handler;
    if (baseHandler === undefined) {
      throw new Error("user:list base handler missing");
    }
    const result = await baseHandler(query, ctx);
    if (result === null || typeof result !== "object" || !("rows" in result)) {
      return result;
    }
    const envelope = result as { rows: readonly Record<string, unknown>[] };
    const rows = await attachTenantLabels(envelope.rows, dbForList(ctx));
    return { ...envelope, rows };
  },
};

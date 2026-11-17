import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { buildSessionRoles } from "@cosmicdrift/kumiko-framework/engine";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { isPrincipalRowBlocked, type UserStatus, userTable } from "../user/index.ts";
import { tenantMembershipsTable } from "./membership-table.ts";

// unknown_principal is a principal without a user row (bootstrap/system actor); the caller decides what that means.
export type LiveTenantRoles =
  | { readonly kind: "active"; readonly roles: readonly string[] }
  | { readonly kind: "unknown_principal" }
  | { readonly kind: "blocked" }
  | { readonly kind: "not_a_member" };

// Resolved on every request instead of read from a token claim, so a revoked right takes effect immediately.
export async function resolveLiveTenantRoles(
  db: DbRunner,
  userId: string,
  tenantId: string,
): Promise<LiveTenantRoles> {
  const [user, membership] = await Promise.all([
    fetchOne<{ status: UserStatus; isDeleted: boolean; roles: string | null }>(db, userTable, {
      id: userId,
    }),
    fetchOne<{ roles: string | null }>(db, tenantMembershipsTable, { userId, tenantId }),
  ]);
  if (!user) return { kind: "unknown_principal" };
  if (isPrincipalRowBlocked(user)) return { kind: "blocked" };
  if (!membership) return { kind: "not_a_member" };
  return {
    kind: "active",
    roles: buildSessionRoles(parseRoles(user.roles), parseRoles(membership.roles)),
  };
}

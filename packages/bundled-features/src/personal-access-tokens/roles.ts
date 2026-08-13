import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { buildSessionRoles } from "@cosmicdrift/kumiko-framework/engine";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
// kumiko-lint-ignore cross-feature-import shared lifecycle-status gate with session auth
import { isPrincipalBlocked } from "../sessions";
import { tenantMembershipsTable } from "../tenant";
import { type UserStatus, userTable } from "../user";

// Live role resolution for a (userId, tenantId), mirroring login.write.ts:
// global roles (users.roles) ∪ tenant-membership roles (forbidden roles
// stripped via stripForbiddenMembershipRoles, see engine/membership-roles).
// Resolved fresh on every PAT request — a snapshot baked at mint
// time would keep a since-revoked admin role for the token's whole (months-long)
// life. Returns null when the user has no membership in that tenant: removed
// from the tenant → the PAT stops authenticating there. Also null when the
// user's lifecycle status blocks them (fw security-welle2) — collapsed onto
// the same "no roles" outcome as missing-membership so a blocked user's PAT
// gets an identical 401 to an unknown token (no status oracle).
export async function resolvePatRoles(
  db: DbConnection,
  userId: string,
  tenantId: string,
): Promise<readonly string[] | null> {
  const memberships = await selectMany<{ roles: string }>(db, tenantMembershipsTable, {
    userId,
    tenantId,
  });
  const membership = memberships[0];
  if (!membership) return null;
  const userRow = await fetchOne<{ roles: string | null; status: UserStatus }>(db, userTable, {
    id: userId,
  });
  if (userRow && isPrincipalBlocked(userRow.status)) return null;
  const globalRoles = parseRoles(userRow?.roles ?? null);
  return buildSessionRoles(globalRoles, parseRoles(membership.roles));
}

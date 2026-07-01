import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { stripForbiddenMembershipRoles } from "@cosmicdrift/kumiko-framework/engine";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { tenantMembershipsTable } from "../tenant";
import { userTable } from "../user";

// Live role resolution for a (userId, tenantId), mirroring login.write.ts:
// global roles (users.roles) ∪ tenant-membership roles (forbidden roles
// stripped). Resolved fresh on every PAT request — a snapshot baked at mint
// time would keep a since-revoked admin role for the token's whole (months-long)
// life. Returns null when the user has no membership in that tenant: removed
// from the tenant → the PAT stops authenticating there.
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
  const userRow = await fetchOne<{ roles: string | null }>(db, userTable, { id: userId });
  const globalRoles = parseRoles(userRow?.roles ?? null);
  const membershipRoles = stripForbiddenMembershipRoles(parseRoles(membership.roles));
  return [...new Set([...globalRoles, ...membershipRoles])];
}

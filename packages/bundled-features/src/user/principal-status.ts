import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type {
  PrincipalProfile,
  PrincipalStatus,
  PrincipalStatusPlugin,
} from "@cosmicdrift/kumiko-framework/engine";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { USER_STATUS, type UserStatus, userTable } from "./schema/user";

// Locked accounts whose live sessions must be refused. deletionRequested is
// intentionally absent — it's a reversible grace period and the user needs their session to reach cancel-deletion.
const BLOCKED_STATUSES: ReadonlySet<UserStatus> = new Set([
  USER_STATUS.Restricted,
  USER_STATUS.Deleted,
]);

// Shared with personal-access-tokens' resolver and sessions' sessionChecker
// — a PAT or a live session belonging to a locked-out principal is refused the same way.
export function isPrincipalBlocked(status: UserStatus): boolean {
  return BLOCKED_STATUSES.has(status);
}

// Registered via r.useExtension(EXT_PRINCIPAL_STATUS, "user", principalStatusPlugin)
// so resolveActiveMembershipFn can reject a blocked principal without knowing about `user`'s table.
export const principalStatusPlugin: PrincipalStatusPlugin = {
  async resolveStatus(userId, { db }): Promise<PrincipalStatus> {
    const row = await fetchOne<{ status: UserStatus }>(db, userTable, { id: userId });
    if (!row) return "unknown";
    return isPrincipalBlocked(row.status) ? "blocked" : "active";
  },

  // ctx.queryAsMember's global-roles/timezone/locale source — same fields
  // login mints a session from (see login.write.ts gateBuildSession).
  async resolveProfile(userId, { db }): Promise<PrincipalProfile | null> {
    const row = await fetchOne<{ roles: unknown; timezone: string | null; locale: string | null }>(
      db,
      userTable,
      { id: userId },
    );
    if (!row) return null;
    return {
      globalRoles: parseRoles(row.roles),
      ...(row.timezone ? { timezone: row.timezone } : {}),
      ...(row.locale ? { locale: row.locale } : {}),
    };
  },
};

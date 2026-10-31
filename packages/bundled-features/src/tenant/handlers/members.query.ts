import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import * as z from "zod";
import { userTable } from "../../user/index.ts";
import { tenantMembershipsTable } from "../membership-table.ts";
import { decryptMemberUsers, type MemberUserRow } from "./decrypt-member-users.ts";

export const membersQuery = defineQueryHandler({
  name: "members",
  schema: z.object({
    // Optional single-user filter — audit detail (and similar) only need one
    // member's display name, not the full decrypted roster.
    userId: z.string().min(1).optional(),
  }),
  access: { roles: access.admin },
  description:
    "Lists the memberships of the caller's own tenant with each member's decrypted email, display name and roles, optionally narrowed to a single user id.",
  // Decrypted email + display name: legitimate for an agent, never unattended.
  agent: { risk: "high" },
  handler: async (query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "tenant:query:members requires ctx.systemDb — is r.systemScope() still set on the tenant feature?",
      });
    }
    const db = ctx.systemDb.assertTenantMatch(query.user.tenantId);
    const rows = await selectMany(db, tenantMembershipsTable, {
      tenantId: query.user.tenantId,
      ...(query.payload.userId !== undefined ? { userId: query.payload.userId } : {}),
    });

    const userIds = [...new Set(rows.map((row) => row["userId"]))];
    const users =
      userIds.length > 0 ? await selectMany<MemberUserRow>(db, userTable, { id: userIds }) : [];
    const userById = new Map(users.map((u) => [String(u.id), u]));

    const decryptedByUserId = await decryptMemberUsers(users, "tenant:members");

    return rows.map((row) => {
      const user = userById.get(String(row["userId"]));
      const decrypted = user ? decryptedByUserId.get(String(user.id)) : undefined;
      return {
        ...row,
        email: decrypted?.email ?? null,
        displayName: decrypted?.displayName ?? null,
        roles: parseRoles(row["roles"]),
      };
    });
  },
});

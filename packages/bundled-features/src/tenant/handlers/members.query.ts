import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { z } from "zod";
import { decryptStoredPii } from "../../shared";
import { userTable } from "../../user";
import { tenantMembershipsTable } from "../membership-table";

type UserRow = { readonly id: unknown; readonly email?: unknown; readonly displayName?: unknown };

export const membersQuery = defineQueryHandler({
  name: "members",
  schema: z.object({}),
  access: { roles: access.admin },
  handler: async (query, ctx) => {
    const rows = await selectMany(ctx.db, tenantMembershipsTable, {
      tenantId: query.user.tenantId,
    });

    const userIds = [...new Set(rows.map((row) => row["userId"]))];
    const users =
      userIds.length > 0 ? await selectMany<UserRow>(ctx.db, userTable, { id: userIds }) : [];
    const userById = new Map(users.map((u) => [String(u.id), u]));

    return Promise.all(
      rows.map(async (row) => {
        const user = userById.get(String(row["userId"]));
        const email =
          typeof user?.email === "string"
            ? await decryptStoredPii(user.email, "tenant:members")
            : null;
        const displayName =
          typeof user?.displayName === "string"
            ? await decryptStoredPii(user.displayName, "tenant:members")
            : null;
        return {
          ...row,
          email,
          displayName,
          roles: parseRoles(row["roles"]),
        };
      }),
    );
  },
});

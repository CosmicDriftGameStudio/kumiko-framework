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

    // Sequential, not Promise.all: each decrypt hits the KMS adapter's own
    // small dedicated pool (PgKmsAdapter default max: 4) — firing 2 calls
    // per row concurrently for every row exhausts it once membership counts
    // exceed a handful, surfacing as "the connection was closed".
    const decryptedByUserId = new Map<
      string,
      { email: string | null; displayName: string | null }
    >();
    for (const user of users) {
      const email =
        typeof user.email === "string"
          ? await decryptStoredPii(user.email, "email", "tenant:members")
          : null;
      const displayName =
        typeof user.displayName === "string"
          ? await decryptStoredPii(user.displayName, "displayName", "tenant:members")
          : null;
      decryptedByUserId.set(String(user.id), { email, displayName });
    }

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

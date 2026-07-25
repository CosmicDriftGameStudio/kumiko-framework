import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { z } from "zod";
import { decryptStoredPii, mapWithConcurrency } from "../../shared";
import { userTable } from "../../user";
import { tenantMembershipsTable } from "../membership-table";

type UserRow = { readonly id: unknown; readonly email?: unknown; readonly displayName?: unknown };

// Bounded, not Promise.all/sequential: each decrypt hits the KMS adapter's
// own small dedicated pool (PgKmsAdapter default max: 4). Promise.all fires
// one call per user unbounded and exhausts the pool once membership counts
// exceed a handful, surfacing as "the connection was closed"; a strict
// sequential loop caps concurrency at 1 and leaves 3 pool slots idle.
const KMS_POOL_CONCURRENCY = 4;

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

    const decrypted = await mapWithConcurrency(users, KMS_POOL_CONCURRENCY, async (user) => {
      const email =
        typeof user.email === "string"
          ? await decryptStoredPii(user.email, "email", "tenant:members")
          : null;
      const displayName =
        typeof user.displayName === "string"
          ? await decryptStoredPii(user.displayName, "displayName", "tenant:members")
          : null;
      return { userId: String(user.id), email, displayName };
    });
    const decryptedByUserId = new Map(decrypted.map((d) => [d.userId, d]));

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

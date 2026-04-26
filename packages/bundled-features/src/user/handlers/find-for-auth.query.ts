import type { DbRow } from "@kumiko/framework/db";
import { access, defineQueryHandler } from "@kumiko/framework/engine";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { userTable } from "../schema/user";

// Privileged auth lookup: returns the full user row — including passwordHash —
// by email OR id (exactly one, enforced by the schema). Used by the auth
// features via ctx.queryAs(systemUser, ...).
//
// Field-level read rules allow passwordHash for the "privileged" role set,
// so system callers see everything; any other caller is filtered even if
// they somehow reach this handler. Access is also restricted to privileged
// — regular users or tenant admins cannot call this at all.
export const findForAuthQuery = defineQueryHandler({
  name: "user:find-for-auth",
  schema: z
    .object({
      email: z.email().optional(),
      id: z.uuid().optional(),
    })
    .refine(
      // XOR: exactly one must be set. Neither or both is a caller bug, not an
      // ambiguous lookup.
      (v) => (v.email !== undefined) !== (v.id !== undefined),
      { message: "exactly one of email or id must be set" },
    ),
  access: { roles: access.privileged },
  handler: async (query, ctx) => {
    const condition =
      query.payload.email !== undefined
        ? eq(userTable["email"], query.payload.email)
        : eq(userTable["id"], query.payload.id as string);

    const [row] = await ctx.db.select().from(userTable).where(condition).limit(1);
    return (row as DbRow) ?? null;
  },
});

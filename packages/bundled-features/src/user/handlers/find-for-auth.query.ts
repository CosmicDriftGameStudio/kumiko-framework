import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { userTable } from "../schema/user";

// Privileged auth lookup: returns the full user row — including passwordHash —
// by email OR id (exactly one, enforced by the schema). Used by the auth
// features via ctx.queryAs(systemUser, ...).
//
// Access is system-only, NOT access.privileged: every query handler is
// reachable via POST /api/query, and "SystemAdmin" is an assignable app
// role — privileged would hand any SystemAdmin the raw passwordHash over
// HTTP. The "system" role can't be minted into a session (only
// createSystemUser() carries it), so system-only keeps this handler
// internal to ctx.queryAs(systemUser, ...) callers.
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
  access: { roles: access.system },
  handler: async (query, ctx) => {
    const where =
      query.payload.email !== undefined
        ? { email: query.payload.email }
        : { id: query.payload.id as string }; // @cast-boundary engine-payload

    return (await fetchOne(ctx.db, userTable, where)) ?? null;
  },
});

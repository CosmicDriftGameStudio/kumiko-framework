import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { userMfaTable } from "../schema/user-mfa";

// "Is MFA enabled for me" — the one thing a settings screen needs before it
// can decide whether to show the enrollment flow or the disable/regenerate
// actions. No client-side signal (session/JWT) carries this today, so
// without this query every app builds its own row-existence check via a
// side channel. Plain fetchOne — no need for the entity's decrypting
// executor.detail() (see db/queries.ts's findUserMfaRow), existence is all
// the caller wants.
export const mfaStatusQuery = defineQueryHandler({
  name: "user-mfa:status",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (query, ctx) => {
    const row = await fetchOne<{ id: string }>(ctx.db, userMfaTable, {
      userId: query.user.id,
    });
    return { enabled: row !== undefined };
  },
});

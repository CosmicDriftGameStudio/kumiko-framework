import { insertOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { mintPatToken } from "../hash";
import { apiTokenTable } from "../schema/api-token";

// Mint a PAT for the calling user in their active tenant. The plaintext token
// is returned ONCE (data.token) and never again — only the hash is stored.
// `scopes` are granted scope names; unknown names simply grant nothing at
// resolve time (fail-closed), so no cross-check against the app config here.
export const createPatWrite = defineWriteHandler({
  name: "create",
  schema: z.object({
    name: z.string().min(1).max(120),
    scopes: z.array(z.string().min(1)).min(1),
    expiresInDays: z.number().int().positive().max(3650).optional(),
  }),
  access: { openToAll: true },
  handler: async (event, ctx) => {
    const { raw, hash, prefix } = mintPatToken();
    const now = Temporal.Now.instant();
    const id = generateId();
    await insertOne(ctx.db, apiTokenTable, {
      id,
      userId: event.user.id,
      tenantId: event.user.tenantId,
      name: event.payload.name,
      tokenHash: hash,
      prefix,
      scopes: JSON.stringify(event.payload.scopes),
      createdAt: now,
      expiresAt: event.payload.expiresInDays
        ? now.add({ hours: 24 * event.payload.expiresInDays })
        : null,
      revokedAt: null,
    });
    return { isSuccess: true, data: { id, token: raw, prefix } };
  },
});

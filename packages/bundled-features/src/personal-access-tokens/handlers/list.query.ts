import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { decryptStoredPii } from "../../shared";
import { apiTokenTable } from "../schema/api-token";

// The caller's own tokens — metadata only, never the hash or plaintext.
// Includes revoked/expired rows so the UI can show history; `prefix` is the
// only fragment of the secret ever exposed.
export const listPatQuery = defineQueryHandler({
  name: "mine",
  schema: z.object({}),
  access: { openToAll: true },
  handler: async (query, ctx) => {
    const rows = await selectMany<{
      id: string;
      name: string;
      prefix: string;
      scopes: string;
      createdAt: unknown;
      expiresAt: unknown;
      revokedAt: unknown;
    }>(
      ctx.db,
      apiTokenTable,
      { userId: query.user.id },
      { orderBy: { col: "createdAt", direction: "desc" } },
    );
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        name: await decryptStoredPii(r.name, "pat:list"),
        prefix: r.prefix,
        scopes: parseScopeNames(r.scopes),
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        revokedAt: r.revokedAt,
      })),
    );
  },
});

function parseScopeNames(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

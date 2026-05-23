import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { tenantSecretsTable } from "../table";

// Lists all secrets for the current tenant. Returns redactedPreview, never
// the plaintext. Decryption would be pointless here anyway — this is the
// TenantAdmin UI, not feature code that needs the value.
export const listQuery = defineQueryHandler({
  name: "list",
  schema: z.object({}),
  access: { roles: ["TenantAdmin"] },
  handler: async (event, ctx) => {
    const rows = await selectMany<{
      key: string;
      kekVersion: number;
      metadata: { redactedPreview?: string; hint?: string };
      lastRotatedAt: unknown;
      insertedAt: unknown;
    }>(ctx.db.raw, tenantSecretsTable, { tenantId: event.user.tenantId }, {
      orderBy: { col: "key", direction: "asc" },
    });
    return rows.map((r) => ({
      key: r.key,
      redactedPreview: r.metadata.redactedPreview ?? null,
      hint: r.metadata.hint ?? null,
      kekVersion: r.kekVersion,
      lastRotatedAt: r.lastRotatedAt,
      createdAt: r.insertedAt,
    }));
  },
});

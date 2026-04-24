import { defineQueryHandler } from "@kumiko/framework/engine";
import { eq } from "drizzle-orm";
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
    const rows = await ctx.db.raw
      .select({
        key: tenantSecretsTable.key,
        kekVersion: tenantSecretsTable.kekVersion,
        metadata: tenantSecretsTable.metadata,
        lastRotatedAt: tenantSecretsTable.lastRotatedAt,
        // Post-ES the projection uses the framework base-columns — `inserted_at`
        // replaces the legacy `created_at`. Response stays on the `createdAt`
        // key so Admin-UIs don't have to re-map.
        createdAt: tenantSecretsTable.insertedAt,
      })
      .from(tenantSecretsTable)
      .where(eq(tenantSecretsTable.tenantId, event.user.tenantId))
      .orderBy(tenantSecretsTable.key);

    return rows.map((r) => ({
      key: r.key,
      redactedPreview: r.metadata.redactedPreview ?? null,
      hint: r.metadata.hint ?? null,
      kekVersion: r.kekVersion,
      lastRotatedAt: r.lastRotatedAt,
      createdAt: r.createdAt,
    }));
  },
});

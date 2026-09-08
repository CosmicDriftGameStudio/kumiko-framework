import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { type AccessRule, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { DEFAULT_SECRETS_ACCESS } from "../constants";
import { tenantSecretsTable } from "../table";

// Lists all secrets for the current tenant. Returns redactedPreview, never
// the plaintext. Decryption would be pointless here anyway — this is the
// TenantAdmin UI, not feature code that needs the value.
export function createListHandler(access: AccessRule = DEFAULT_SECRETS_ACCESS) {
  return defineQueryHandler({
    name: "list",
    description:
      "Lists the secrets stored for the caller's tenant by key with a redacted preview, hint, key version and rotation date — never the plaintext; use it to check which credentials are set.",
    schema: z.object({}),
    access,
    handler: async (event, ctx) => {
      const rows = await selectMany<{
        key: string;
        kekVersion: number;
        metadata: { redactedPreview?: string; hint?: string };
        lastRotatedAt: unknown;
        insertedAt: unknown;
      }>(
        ctx.db.raw,
        tenantSecretsTable,
        { tenantId: event.user.tenantId },
        {
          orderBy: { col: "key", direction: "asc" },
        },
      );
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
}

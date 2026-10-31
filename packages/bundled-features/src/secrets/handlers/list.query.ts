import { type AccessRule, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { resolveSecretTarget, secretScopeSchema } from "../secret-scope.ts";
import { tenantSecretsTable } from "../table.ts";
import { DEFAULT_SECRETS_ACCESS } from "../web/constants.ts";

// Lists all secrets for the current tenant. Returns redactedPreview, never
// the plaintext. Decryption would be pointless here anyway — this is the
// TenantAdmin UI, not feature code that needs the value.
export function createListHandler(access: AccessRule = DEFAULT_SECRETS_ACCESS) {
  return defineQueryHandler({
    name: "list",
    description:
      "Lists the secrets stored for the caller's tenant (or, with scope system and the SystemAdmin role, the platform-wide ones) by key with a redacted preview, hint, key version and rotation date — never the plaintext; use it to check which credentials are set.",
    schema: z.object({ scope: secretScopeSchema }),
    access,
    handler: async (event, ctx) => {
      const target = resolveSecretTarget(event.user, event.payload.scope);
      if (!target.ok) throw target.error;
      const rows = await ctx.db.selectMany<{
        key: string;
        kekVersion: number;
        metadata: { redactedPreview?: string; hint?: string };
        lastRotatedAt: unknown;
        insertedAt: unknown;
      }>(
        tenantSecretsTable,
        { tenantId: target.tenantId },
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

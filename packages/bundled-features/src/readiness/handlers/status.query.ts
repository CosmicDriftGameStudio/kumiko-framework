import {
  buildProviderSelectionGate,
  collectMissingRequiredConfig,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { requireSecretsContext } from "@cosmicdrift/kumiko-bundled-features/secrets";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { ReadinessQueries } from "../constants";

export type ReadinessMissingSecret = { readonly key: string };

// The one-call rollup config:query:readiness deliberately refused: that
// query can't see secrets, this feature requires both — so it may verdict.
export const statusQuery = defineQueryHandler({
  name: "status",
  schema: z.object({}),
  // Same gate as secrets:query:list — the response names missing secrets.
  access: { roles: ["TenantAdmin"] },
  handler: async (query, ctx) => {
    // One gate for both halves: required keys/secrets of provider-features
    // count only while their provider is the selected one (r.extensionSelector).
    const gate = await buildProviderSelectionGate(ctx, ReadinessQueries.status, query.user);
    // skipAccessFilter: das Verdict muss ALLE required Keys zählen — der
    // Handler selbst ist TenantAdmin-gated, der Per-Key-Filter wäre hier
    // eine ready:true-Lüge für SystemAdmin-gated Keys (277/1).
    const missingConfig = await collectMissingRequiredConfig(
      ctx,
      ReadinessQueries.status,
      query.user,
      gate,
      { skipAccessFilter: true },
    );

    // has() is metadata-only: no decryption, no read-audit event — a
    // readiness probe must not pollute the credential-read trail.
    const secrets = requireSecretsContext(ctx, ReadinessQueries.status);
    const missingSecrets: ReadinessMissingSecret[] = [];
    for (const [qualifiedName, keyDef] of ctx.registry.getAllSecretKeys()) {
      if (keyDef.required !== true) continue;
      if (!gate(qualifiedName)) continue;
      if (!(await secrets.has(query.user.tenantId, qualifiedName))) {
        missingSecrets.push({ key: qualifiedName });
      }
    }

    return {
      missingConfig,
      missingSecrets,
      ready: missingConfig.length === 0 && missingSecrets.length === 0,
    };
  },
});

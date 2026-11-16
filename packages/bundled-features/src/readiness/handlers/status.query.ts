import {
  buildProviderSelectionGate,
  collectMissingRequiredConfig,
  requireConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { requireSecretsContext } from "@cosmicdrift/kumiko-bundled-features/secrets";
import {
  type ConfigKeyDefinition,
  defineQueryHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { mapWithConcurrency } from "../../shared/index.ts";
import { ReadinessQueries, SECRET_PRESENCE_CONCURRENCY } from "../constants.ts";

export type ReadinessMissingSecret = { readonly key: string };

// The one-call rollup config:query:readiness deliberately refused: that
// query can't see secrets, this feature requires both — so it may verdict.
export const statusQuery = defineQueryHandler({
  name: "status",
  description:
    "Reports whether the caller's tenant is fully configured, naming every required config key and every required secret that is still unset; use it to answer what is missing before go-live.",
  schema: z.object({}),
  // Same gate as secrets:query:list — the response names missing secrets.
  access: { roles: ["TenantAdmin"] },
  handler: async (query, ctx) => {
    // One gate for both halves: required keys/secrets of provider-features
    // count only while their provider is the selected one (r.extensionSelector).
    const gate = await buildProviderSelectionGate(ctx, ReadinessQueries.status, query.user, ctx.db);
    // skipAccessFilter: the verdict must count ALL required keys—the
    // Handler itself is TenantAdmin-gated; the per-key filter would falsely
    // report ready:true for SystemAdmin-gated keys.
    const missingConfig = await collectMissingRequiredConfig(
      ctx,
      ReadinessQueries.status,
      query.user,
      ctx.db,
      gate,
      { skipAccessFilter: true },
    );

    // has() is metadata-only: no decryption, no read-audit event — a
    // readiness probe must not pollute the credential-read trail.
    const secrets = requireSecretsContext(
      { secrets: ctx.services.secrets, user: ctx.user },
      ReadinessQueries.status,
    );
    const resolver = requireConfigResolver(ctx, ReadinessQueries.status);
    const countedSecretKeys = [...ctx.registry.getAllSecretKeys()].filter(([qualifiedName]) =>
      gate(qualifiedName),
    );
    const conditionKeyDefs = new Map<string, ConfigKeyDefinition>();
    for (const [, keyDef] of countedSecretKeys) {
      if (keyDef.required === true || !keyDef.requiredWhenConfigSet) continue;
      const conditionDef = ctx.registry.getConfigKey(keyDef.requiredWhenConfigSet);
      if (conditionDef) conditionKeyDefs.set(keyDef.requiredWhenConfigSet, conditionDef);
    }
    // No secrets reader on purpose: a backing="secrets" condition would decrypt and write a read-audit event.
    const conditions = await resolver.getCascadeBatch(
      [...conditionKeyDefs.keys()],
      conditionKeyDefs,
      query.user.tenantId,
      query.user.id,
      ctx.db,
    );
    const requiredSecretKeys = countedSecretKeys
      .filter(([, keyDef]) => {
        if (keyDef.required === true) return true;
        const conditionValue = keyDef.requiredWhenConfigSet
          ? conditions.get(keyDef.requiredWhenConfigSet)?.value
          : undefined;
        return typeof conditionValue === "string" && conditionValue.trim() !== "";
      })
      .map(([qualifiedName]) => qualifiedName);
    const present = await mapWithConcurrency(
      requiredSecretKeys,
      SECRET_PRESENCE_CONCURRENCY,
      (key) => secrets.has(query.user.tenantId, key),
    );
    const missingSecrets: ReadinessMissingSecret[] = requiredSecretKeys
      .filter((_, index) => present[index] !== true)
      .map((key) => ({ key }));

    return {
      missingConfig,
      missingSecrets,
      ready: missingConfig.length === 0 && missingSecrets.length === 0,
    };
  },
});

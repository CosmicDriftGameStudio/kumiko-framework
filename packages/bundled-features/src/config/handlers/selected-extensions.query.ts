import {
  type ConfigKeyDefinition,
  defineQueryHandler,
  isEncryptedAtRest,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { requireConfigResolver, requireSystemDb } from "../feature";
import { redactInheritedCascade, shouldRedactInherited } from "../read-redaction";
import { hasConfigAccess } from "../write-helpers";

// Flat `{ [extensionName]: selectedPluginId }` so a settings dashboard can show
// panels per selected provider (visibleWhen field = extension name).
export const selectedExtensionsQuery = defineQueryHandler({
  name: "config-value:selected-extensions",
  description:
    "Returns, per extension point with a config selector, the plugin id the caller's tenant has selected; use it to show only the settings of the active provider.",
  schema: z.object({}).strict(),
  // UI plumbing for panel visibility; config:query:values already gives the agent these values.
  agent: { expose: false },
  // Per-key read access enforced via hasConfigAccess inside the handler.
  access: {
    openToAll: {
      reason:
        "any signed-in user may call selected-extensions; the handler only returns " +
        "selectors whose config key the caller's roles may read, resolved for the caller's own tenant",
    },
  },
  rateLimit: {
    disabled: true,
    reason:
      "self-scoped read of the caller's own selector values, hit on every settings page load; " +
      "per-tenant bucket would throttle the whole tenant, L1 IP limit still applies",
  },
  handler: async (query, ctx) => {
    const db = requireSystemDb(
      ctx,
      "config:query:config-value:selected-extensions",
      query.user.tenantId,
    );
    const resolver = requireConfigResolver(ctx, "config:query:config-value:selected-extensions");
    const readableSelectors = new Map<string, ConfigKeyDefinition>();
    const extensionBySelectorKey = new Map<string, string>();
    for (const [extensionName, selectorKey] of ctx.registry.getAllExtensionSelectors()) {
      const keyDef = ctx.registry.getConfigKey(selectorKey);
      if (!keyDef || !hasConfigAccess(keyDef.access.read, query.user.roles)) continue;
      if (isEncryptedAtRest(keyDef)) continue;
      readableSelectors.set(selectorKey, keyDef);
      extensionBySelectorKey.set(selectorKey, extensionName);
    }
    const cascades = await resolver.getCascadeBatch(
      [...readableSelectors.keys()],
      readableSelectors,
      query.user.tenantId,
      query.user.id,
      db,
      ctx.secrets,
    );
    const selected: Record<string, string> = {};
    for (const [selectorKey, keyDef] of readableSelectors) {
      const rawCascade = cascades.get(selectorKey);
      if (!rawCascade) continue;
      const cascade = shouldRedactInherited(keyDef, query.user.roles)
        ? redactInheritedCascade(rawCascade)
        : rawCascade;
      const pluginId = typeof cascade.value === "string" ? cascade.value.trim() : "";
      const extensionName = extensionBySelectorKey.get(selectorKey);
      if (pluginId !== "" && extensionName !== undefined) selected[extensionName] = pluginId;
    }
    return selected;
  },
});

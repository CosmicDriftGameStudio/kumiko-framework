import {
  bootRuleError,
  createWebhookContractResolver,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { PERSONAL_ACCESS_TOKENS_BOOT_RULES } from "./boot-rules.ts";
import { PAT_FEATURE } from "./web/constants.ts";
import type { PatScopeConfig } from "./web/scopes.ts";

function entityNameOf(qualifiedName: string): string {
  const dot = qualifiedName.lastIndexOf(".");
  return dot > 0 ? qualifiedName.slice(0, dot) : qualifiedName;
}

export function validateScopeEventContracts(
  scopes: PatScopeConfig,
  features: readonly FeatureDefinition[],
): void {
  const resolver = createWebhookContractResolver(features);
  for (const [domain, def] of Object.entries(scopes)) {
    for (const qn of def.events ?? []) {
      if (resolver.get(qn)) continue;
      throw bootRuleError(PERSONAL_ACCESS_TOKENS_BOOT_RULES.scopeEventWithoutContract, {
        message:
          `[${PAT_FEATURE}] scope "${domain}" lists event "${qn}" without a public contract. ` +
          "Declare it with r.defineWebhookEvent(...), or set webhookEvents: true on the entity to release its <entity>.created/.updated/.deleted events " +
          `(entity "${entityNameOf(qn)}" has no such opt-in); internal r.defineEvent events are never released.`,
      });
    }
  }
}

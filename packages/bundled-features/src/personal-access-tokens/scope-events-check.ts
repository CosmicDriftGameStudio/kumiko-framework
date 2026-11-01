import {
  createWebhookContractResolver,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { PAT_FEATURE } from "./web/constants.ts";
import type { PatScopeConfig } from "./web/scopes.ts";

export function validateScopeEventContracts(
  scopes: PatScopeConfig,
  features: readonly FeatureDefinition[],
): void {
  const resolver = createWebhookContractResolver(features);
  for (const [domain, def] of Object.entries(scopes)) {
    for (const qn of def.events ?? []) {
      if (resolver.get(qn)) continue;
      throw new Error(
        `[${PAT_FEATURE}] scope "${domain}" lists event "${qn}" without a public contract. ` +
          "Declare it with r.defineWebhookEvent(...) or list an entity event (<entity>.created/.updated/.deleted); internal r.defineEvent events are never released.",
      );
    }
  }
}

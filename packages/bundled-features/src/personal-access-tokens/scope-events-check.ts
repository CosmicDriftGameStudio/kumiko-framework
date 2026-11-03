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
  const qnByWireName = new Map<string, string>();
  for (const [domain, def] of Object.entries(scopes)) {
    for (const qn of def.events ?? []) {
      const contract = resolver.get(qn);
      if (contract) {
        const existing = qnByWireName.get(contract.wireName);
        if (existing !== undefined && existing !== contract.qn) {
          throw bootRuleError(PERSONAL_ACCESS_TOKENS_BOOT_RULES.releasedWireNameCollision, {
            message: `[${PAT_FEATURE}] released webhook wire name "${contract.wireName}" is used by both "${existing}" and "${contract.qn}"; receivers tell events apart by wire name, give one of them another wireName.`,
          });
        }
        qnByWireName.set(contract.wireName, contract.qn);
        continue;
      }
      throw bootRuleError(PERSONAL_ACCESS_TOKENS_BOOT_RULES.scopeEventWithoutContract, {
        message:
          `[${PAT_FEATURE}] scope "${domain}" lists event "${qn}" without a public contract. ` +
          "Declare it with r.defineWebhookEvent(...), or set webhookEvents: true on the entity to release its <entity>.created/.updated/.deleted events " +
          `(entity "${entityNameOf(qn)}" has no such opt-in); internal r.defineEvent events are never released.`,
      });
    }
  }
}

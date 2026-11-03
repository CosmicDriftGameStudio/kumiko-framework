import {
  bootRuleError,
  createWebhookContractResolver,
  type FeatureDefinition,
  findEntity,
  WEBHOOK_ENTITY_VERBS,
} from "@cosmicdrift/kumiko-framework/engine";
import { PERSONAL_ACCESS_TOKENS_BOOT_RULES } from "./boot-rules.ts";
import { PAT_FEATURE } from "./web/constants.ts";
import type { PatScopeConfig } from "./web/scopes.ts";

// Why an event without a contract is not released: only an `<entity>.<verb>` name can be fixed by
// an entity opt-in, so every other shape gets no entity hint.
function missingContractHint(
  qualifiedName: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): string {
  const dot = qualifiedName.lastIndexOf(".");
  const verb = qualifiedName.slice(dot + 1);
  if (dot <= 0 || !WEBHOOK_ENTITY_VERBS.some((candidate) => candidate === verb)) {
    return "internal r.defineEvent events are never released.";
  }
  const entityName = qualifiedName.slice(0, dot);
  return findEntity(featureMap, entityName) === undefined
    ? `there is no entity "${entityName}".`
    : `entity "${entityName}" has no such opt-in.`;
}

export function validateScopeEventContracts(
  scopes: PatScopeConfig,
  features: readonly FeatureDefinition[],
): void {
  const resolver = createWebhookContractResolver(features);
  const featureMap = new Map(features.map((feature) => [feature.name, feature]));
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
          "Declare it with r.defineWebhookEvent(...), or set webhookEvents: true on the entity to release its <entity>.created/.updated/.deleted events; " +
          missingContractHint(qn, featureMap),
      });
    }
  }
}

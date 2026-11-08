import type { QueryHandlerDef } from "@cosmicdrift/kumiko-types/handlers";
import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { ENTITY_DECLARATION_RULES } from "./entity-declaration-rules.ts";

export function validateCrossTenantFileRead(
  feature: FeatureDefinition,
  queryHandlers: ReadonlyMap<string, QueryHandlerDef>,
): void {
  for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
    const declaration = entity.crossTenantFileRead;
    if (declaration === undefined) continue;
    if (declaration.reason.trim().length === 0) {
      throw bootRuleError(ENTITY_DECLARATION_RULES.crossTenantFileReadReasonMissing, {
        message: `[Feature ${feature.name}] entity "${entityName}" declares crossTenantFileRead without a reason; state why its files are readable across tenants.`,
      });
    }
    if (!queryHandlers.has(declaration.query)) {
      throw bootRuleError(ENTITY_DECLARATION_RULES.crossTenantFileReadQueryUnregistered, {
        message: `[Feature ${feature.name}] entity "${entityName}" declares crossTenantFileRead.query "${declaration.query}" which is not a registered query-handler. Check the QN spelling (expected "<feature>:query:<short>") and that the handler is declared via r.queryHandler(...).`,
      });
    }
  }
}

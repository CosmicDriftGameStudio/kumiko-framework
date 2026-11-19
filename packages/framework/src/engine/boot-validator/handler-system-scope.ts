import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { HANDLER_DECLARATION_RULES } from "./handler-declaration-rules.ts";

// The marker types ctx.systemDb as present; only an r.systemScope() feature makes that true.
export function validateHandlerSystemScope(feature: FeatureDefinition): void {
  if (feature.systemScope) return;
  const handlers = [
    ...Object.values(feature.writeHandlers),
    ...Object.values(feature.queryHandlers),
  ];
  const declaring = handlers.find((handler) => handler.systemScope === true);
  // skip: no handler in this feature declares the marker
  if (declaring === undefined) return;
  throw bootRuleError(HANDLER_DECLARATION_RULES.systemScopeWithoutFeatureScope, {
    message: `[Feature ${feature.name}] handler "${declaring.name}" declares systemScope: true, but the feature does not call r.systemScope()`,
  });
}

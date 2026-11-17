import { bootRuleError } from "./boot-validator/boot-rule.ts";
import { FEATURE_DEFINITION_RULES } from "./boot-validator/definition-feature-rules.ts";

export function isObjectArgument(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

// Untyped JS callers bypass the types; without this check a positional call would
// register a definition built from undefined fields instead of failing.
export function throwObjectArgumentRequired(featureName: string, method: string): never {
  throw bootRuleError(FEATURE_DEFINITION_RULES.optionsObjectRequired, {
    message: `[Feature ${featureName}] r.${method}() takes one options object`,
  });
}

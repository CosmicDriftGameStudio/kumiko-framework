import { parseQn, toKebab } from "./qualified-name";
import type { Registry, ValidationError } from "./types";

export type { ValidationError };

export function runValidation(
  registry: Registry,
  hookName: string,
  data: Readonly<Record<string, unknown>>,
): readonly ValidationError[] | null {
  const errors: ValidationError[] = [];

  // hookName is a qualified name like "feature:write:task:create".
  // Validation hooks are stored with the unqualified short name in the feature definition.
  const parsed = parseQn(hookName);

  for (const [featureName, feature] of registry.features) {
    if (toKebab(featureName) !== parsed.scope) continue;

    const validationHooks = feature.hooks?.validation;
    if (!validationHooks) continue;

    // Find the hook by matching the QN name segment against the stored short name.
    // Both use colon convention (e.g. "task:create"), so direct match works.
    const hook = validationHooks[parsed.name];
    if (hook) {
      const result = hook(data);
      if (result) errors.push(...result);
    }
  }

  return errors.length > 0 ? errors : null;
}

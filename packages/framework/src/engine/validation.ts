import type { Registry, ValidationError } from "./types";

export type { ValidationError };

export function runValidation(
  registry: Registry,
  hookName: string,
  data: Readonly<Record<string, unknown>>,
): readonly ValidationError[] | null {
  const errors: ValidationError[] = [];

  for (const [featureName, feature] of registry.features) {
    const validationHooks = feature.hooks.validation;
    if (!validationHooks) continue;

    // Validation hooks are stored with the short name in the feature definition.
    // The hookName from the dispatcher is prefixed (e.g., "echo.item.create").
    // Strip the feature prefix to find the hook.
    const prefix = `${featureName}.`;
    const shortName = hookName.startsWith(prefix) ? hookName.slice(prefix.length) : hookName;

    const hook = validationHooks[shortName];
    if (!hook) continue;

    const result = hook(data);
    if (result) errors.push(...result);
  }

  return errors.length > 0 ? errors : null;
}

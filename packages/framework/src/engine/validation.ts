import type { Registry, ValidationError } from "./types";

export type { ValidationError };

export function runValidation(
  registry: Registry,
  hookName: string,
  data: Readonly<Record<string, unknown>>,
): readonly ValidationError[] | null {
  const errors: ValidationError[] = [];

  for (const feature of registry.features.values()) {
    const validationHooks = feature.hooks.validation;
    if (!validationHooks) continue;

    const hook = validationHooks[hookName];
    if (!hook) continue;

    const result = hook(data);
    if (result) errors.push(...result);
  }

  return errors.length > 0 ? errors : null;
}

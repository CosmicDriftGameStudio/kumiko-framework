// Narrowing helpers shared by the ai-, mail- and file-foundation factories.

import { InternalError, UnconfiguredError } from "@cosmicdrift/kumiko-framework/errors";

/** Throws InternalError (500): an undefined config value is a registry misconfiguration. */
export function requireDefined<T>(value: T | undefined, featureName: string, label: string): T {
  if (value === undefined) {
    throw new InternalError({
      message: `${featureName}: '${label}' config key resolved to undefined — registry misconfigured (no value + no default)`,
    });
  }
  return value;
}

/** Trims; throws UnconfiguredError (422, code "unconfigured") when the value is empty. */
export function requireNonEmpty(
  value: string | undefined,
  featureName: string,
  label: string,
  uiHint = "Set via tenant-admin UI or seed-handler.",
): string {
  const trimmed = requireDefined(value, featureName, label).trim();
  if (trimmed.length === 0) {
    throw new UnconfiguredError({ feature: featureName, key: label, hint: uiHint });
  }
  return trimmed;
}

/** Throws UnconfiguredError (422, code "unconfigured") when the secret is unset. */
export function requireSecretSet<T>(
  value: T | undefined,
  featureName: string,
  key: string,
  uiHint = "Set via secrets:write:set or the tenant-admin UI.",
): T {
  if (value === undefined) {
    throw new UnconfiguredError({ feature: featureName, key, hint: uiHint });
  }
  return value;
}

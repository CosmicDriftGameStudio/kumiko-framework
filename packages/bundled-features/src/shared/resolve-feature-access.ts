import type { AccessRule } from "@cosmicdrift/kumiko-framework/engine";

type FeatureAccessOptions = {
  readonly access?: AccessRule;
  readonly roles?: readonly string[];
};

// `access` wins over the `roles` shorthand; neither set falls back to the feature default.
export function resolveFeatureAccess(
  opts: FeatureAccessOptions,
  defaultAccess: AccessRule,
): AccessRule {
  if (opts.access !== undefined) return opts.access;
  if (opts.roles !== undefined) return { roles: opts.roles };
  return defaultAccess;
}

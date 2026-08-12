import type { VariantSpec } from "@cosmicdrift/kumiko-types/derivatives-types";
import type { Registry } from "../engine/types";

// The field definition IS the whitelist: a request carries a variant NAME,
// never a spec, so no caller can drive an arbitrary render. `hasOwn` and not
// a plain index — `name` comes off a URL segment, and `__proto__` would
// otherwise resolve to something truthy that is not a VariantSpec.
export function resolveFieldVariant(
  registry: Registry,
  entityType: string | null,
  fieldName: string | null,
  name: string,
): VariantSpec | undefined {
  if (entityType === null || fieldName === null) return undefined;
  const field = registry.getEntity(entityType)?.fields[fieldName];
  if (field === undefined) return undefined;
  if (field.type !== "image" && field.type !== "images") return undefined;
  if (field.variants === undefined || !Object.hasOwn(field.variants, name)) return undefined;
  return field.variants[name];
}

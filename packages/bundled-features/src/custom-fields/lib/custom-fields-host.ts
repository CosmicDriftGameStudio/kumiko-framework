import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { CUSTOM_FIELDS_EXTENSION } from "../web/constants.ts";

export function isCustomFieldsHost(registry: Registry, entityName: string): boolean {
  return registry
    .getExtensionUsages(CUSTOM_FIELDS_EXTENSION)
    .some((usage) => usage.entityName === entityName);
}

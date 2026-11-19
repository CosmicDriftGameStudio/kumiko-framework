import { extractTableName } from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { CUSTOM_FIELDS_EXTENSION } from "../web/constants.ts";

export function isCustomFieldsHost(registry: Registry, entityName: string): boolean {
  return registry
    .getExtensionUsages(CUSTOM_FIELDS_EXTENSION)
    .some((usage) => usage.entityName === entityName);
}

// One values projection serves every wired host, so it resolves the host table per event from the registry.
export function customFieldsHostTableName(
  registry: Registry,
  entityName: string,
): string | undefined {
  if (!isCustomFieldsHost(registry, entityName)) return undefined;
  const entityProjection = registry
    .getProjectionsForSource(entityName)
    .find((projection) => projection.isImplicit === true);
  if (!entityProjection) {
    throw new Error(`[custom-fields] wired host "${entityName}" has no entity projection`);
  }
  return extractTableName(entityProjection.table, "custom-fields/host-table");
}

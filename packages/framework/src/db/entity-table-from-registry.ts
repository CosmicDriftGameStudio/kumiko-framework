// The table an entity actually lives in, as the booted registry sees it.
//
// `buildEntityTable` derives a table from the entity definition alone, which is
// right until something changed the projection after registration — an
// extendEntityProjection, a featureName prefix, a table override. The registry
// carries the result of all of that, so a caller that needs to read or write
// the same rows the pipeline writes has to ask the registry first and may only
// fall back to deriving.
//
// Callers are the ones holding a registry and an entity definition but no
// executor: seeds, jobs and consumers that talk to a feature's read model
// directly.

import type { Registry } from "../engine";
import type { SchemaTable } from "./dialect";
import { buildEntityTable } from "./table-builder";

export function entityTableFromRegistry(
  registry: Registry,
  entityName: string,
  entity: Parameters<typeof buildEntityTable>[1],
): SchemaTable {
  for (const projection of registry.getAllProjections().values()) {
    if (!projection.isImplicit) continue;
    if (projection.source !== entityName) continue;
    // @cast-boundary registry-projection — ProjectionDefinition.table is the
    // untyped table object every projection registrar accepts.
    return projection.table as SchemaTable;
  }
  return buildEntityTable(entityName, entity);
}

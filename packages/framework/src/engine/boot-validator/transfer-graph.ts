import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { buildEntityTable } from "../../db/table-builder.ts";
import { tableNameOf } from "../ownership.ts";
import { parseRefTargetEntityName } from "../parse-ref-target.ts";
import {
  findOverDeepTransferChain,
  MAX_TRANSFER_DEPTH,
  resolveTransferAdjacency,
} from "../transfer-adjacency.ts";
import type { FeatureDefinition } from "../types/index.ts";
import { bootRuleError } from "./boot-rule.ts";
import { ENTITY_DECLARATION_RULES } from "./entity-declaration-rules.ts";

// --- Transfer-graph boot validation ---
//
// tenant-handover walks an entity graph across the tenant boundary along two
// declared edge kinds: `parentRef` and plain `reference` fields. Three shapes
// cannot be moved whole (a multiple reference, a chain beyond the depth limit,
// and a side projection that does not move with its source), and all have to
// fail loudly here rather than silently leaving rows behind in the source
// tenant — the partial move is exactly what this validation exists to end.
//
// Scoped to entities declaring `transferable: true`, so a consumer that has
// one of these shapes but never hands that entity over is unaffected.

export { MAX_TRANSFER_DEPTH };

type EntityEntry = { readonly name: string; readonly entity: EntityDefinition };

function allEntities(featureMap: ReadonlyMap<string, FeatureDefinition>): readonly EntityEntry[] {
  const out: EntityEntry[] = [];
  for (const feature of featureMap.values()) {
    for (const [name, entity] of Object.entries(feature.entities ?? {})) {
      out.push({ name, entity });
    }
  }
  return out;
}

// A `multiple` reference stores a jsonb array of ids, which the handover's
// `= ANY($ids)` column match cannot address. Declaring one towards a transferable
// entity would mean its rows never move with their host. A target outside the
// graph (e.g. a plain lookup) is never a host, so it cannot strand anything.
function validateNoMultipleReferenceEdge(
  entry: EntityEntry,
  featureName: string,
  transferable: ReadonlySet<string>,
): void {
  // skip: the entity never travels, so the shape that would strand its rows
  // during a handover cannot arise — rejecting it would break consumers that
  // legitimately declare a multiple reference on a non-transferable entity.
  if (entry.entity.transferable !== true) return;
  for (const [fieldName, field] of Object.entries(entry.entity.fields)) {
    if (field.type !== "reference" || field.multiple !== true) continue;
    if (field.handover === "stay") continue;
    if (!transferable.has(parseRefTargetEntityName(field.entity))) continue;
    throw bootRuleError(ENTITY_DECLARATION_RULES.transferMultipleReference, {
      message:
        `[Kumiko TransferGraph] entity "${entry.name}" declares transferable: true and a ` +
        `multiple reference field "${fieldName}" -> "${field.entity}" (feature: "${featureName}"). ` +
        `A multiple reference stores a jsonb array, which the tenant-handover transfer graph ` +
        `cannot match rows on — those rows would stay behind in the source tenant. ` +
        `Fix: model the link as a single reference on the owning side, or drop transferable ` +
        `from "${entry.name}".`,
    });
  }
}

function transferableEntityTables(
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): ReadonlyMap<string, string> {
  const tables = new Map<string, string>();
  for (const feature of featureMap.values()) {
    for (const [name, entity] of Object.entries(feature.entities ?? {})) {
      if (entity.transferable !== true) continue;
      tables.set(name, tableNameOf(feature.entityTables?.[name] ?? buildEntityTable(name, entity)));
    }
  }
  return tables;
}

// tenant-handover moves the rows of a transferable entity's own table. A projection that
// copies its events into another table keeps those rows in the source tenant, splitting one
// record across two tenants. Multi-stream projections are not checked: their apply keys also
// serve workflow triggers and custom fields, which write into the host table that moves.
function validateNoSideProjection(
  feature: FeatureDefinition,
  transferableTables: ReadonlyMap<string, string>,
): void {
  for (const projection of Object.values(feature.projections)) {
    if (projection.isImplicit === true) continue;
    const sources = [
      ...(typeof projection.source === "string" ? [projection.source] : projection.source),
      ...(projection.extraSources ?? []),
    ];
    const projectionTable = tableNameOf(projection.table);
    for (const source of sources) {
      const entityName = parseRefTargetEntityName(source);
      const entityTable = transferableTables.get(entityName);
      if (entityTable === undefined || entityTable === projectionTable) continue;
      throw bootRuleError(ENTITY_DECLARATION_RULES.transferCustomProjection, {
        message:
          `[Kumiko TransferGraph] projection "${projection.name}" (feature: "${feature.name}") is fed by ` +
          `the transferable entity "${entityName}" but writes into "${projectionTable}", not into the ` +
          `entity table "${entityTable}". tenant-handover moves only the entity table rows, so the ` +
          `projection rows would stay in the source tenant. Fix: move the projected columns into ` +
          `"${entityName}", or drop transferable from "${entityName}".`,
      });
    }
  }
}

export function validateTransferGraph(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const transferable = new Set(
    allEntities(featureMap)
      .filter((e) => e.entity.transferable === true)
      .map((e) => e.name),
  );
  for (const [name, entity] of Object.entries(feature.entities ?? {})) {
    validateNoMultipleReferenceEdge({ name, entity }, feature.name, transferable);
  }

  const adjacency = resolveTransferAdjacency(
    new Map(allEntities(featureMap).map(({ name, entity }) => [name, entity])),
  );

  for (const [name, entity] of Object.entries(feature.entities ?? {})) {
    if (entity.transferable !== true) continue;
    const tooDeep = findOverDeepTransferChain(adjacency, [name]);
    if (tooDeep !== undefined) {
      throw bootRuleError(ENTITY_DECLARATION_RULES.transferGraphTooDeep, {
        message:
          `[Kumiko TransferGraph] the transfer graph rooted at entity "${name}" is deeper than ` +
          `the ${MAX_TRANSFER_DEPTH}-level limit (feature: "${feature.name}"): ` +
          `${tooDeep.join(" -> ")}. Beyond that depth tenant-handover would move fewer rows ` +
          `than the declaration implies. Fix: flatten the chain, or mark a reference field on ` +
          `an entity in it that should not move with its host \`handover: "stay"\`.`,
      });
    }
  }

  validateNoSideProjection(feature, transferableEntityTables(featureMap));
}

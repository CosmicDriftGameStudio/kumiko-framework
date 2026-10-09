import { parseRefTargetEntityName } from "../parse-ref-target.js";
import {
  findOverDeepTransferChain,
  MAX_TRANSFER_DEPTH,
  resolveTransferAdjacency,
} from "../transfer-adjacency.js";
import type { EntityDefinition, FeatureDefinition } from "../types/index.js";

// --- Transfer-graph boot validation (fw#3088) ---
//
// tenant-handover walks an entity graph across the tenant boundary along two
// declared edge kinds: `parentRef` and plain `reference` fields. Two shapes
// cannot be walked, and both have to fail loudly here rather than silently
// leaving rows behind in the source tenant — the partial move is exactly what
// #3088 exists to end.
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
    throw new Error(
      `[Kumiko TransferGraph] entity "${entry.name}" declares transferable: true and a ` +
        `multiple reference field "${fieldName}" -> "${field.entity}" (feature: "${featureName}"). ` +
        `A multiple reference stores a jsonb array, which the tenant-handover transfer graph ` +
        `cannot match rows on — those rows would stay behind in the source tenant. ` +
        `Fix: model the link as a single reference on the owning side, or drop transferable ` +
        `from "${entry.name}".`,
    );
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
      throw new Error(
        `[Kumiko TransferGraph] the transfer graph rooted at entity "${name}" is deeper than ` +
          `the ${MAX_TRANSFER_DEPTH}-level limit (feature: "${feature.name}"): ` +
          `${tooDeep.join(" -> ")}. Beyond that depth tenant-handover would move fewer rows ` +
          `than the declaration implies. Fix: flatten the chain, or mark a reference field on ` +
          `an entity in it that should not move with its host \`handover: "stay"\`.`,
      );
    }
  }
}

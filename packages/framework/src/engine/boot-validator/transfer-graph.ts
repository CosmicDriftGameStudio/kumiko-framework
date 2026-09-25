import { parseRefTargetEntityName } from "../parse-ref-target";
import type { EntityDefinition, FeatureDefinition } from "../types";

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

// The single definition of the limit. It lives here rather than next to the
// resolver in bundled-features because the dependency only runs that way:
// bundled-features imports from the framework, never the reverse.
//
// Guards against a schema whose reference edges span more levels than anyone
// intended — a runaway graph would move rows an operator never associated with
// the handover. Deliberately a constant and not per-feature config: the limit
// is a safety net, and a configurable one gets raised by whoever trips it
// instead of prompting them to reconsider their graph.
export const MAX_TRANSFER_DEPTH = 5;

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

function referenceTargets(entity: EntityDefinition): readonly string[] {
  const targets: string[] = [];
  for (const field of Object.values(entity.fields)) {
    if (field.type !== "reference") continue;
    if (field.multiple === true) continue;
    targets.push(parseRefTargetEntityName(field.entity));
  }
  return targets;
}

// A `multiple` reference stores a jsonb array of ids, which the handover's
// `= ANY($ids)` column match cannot address. Declaring one on a transferable
// entity would mean its rows never move with their host.
function validateNoMultipleReferenceEdge(entry: EntityEntry, featureName: string): void {
  // skip: the entity never travels, so the shape that would strand its rows
  // during a handover cannot arise — rejecting it would break consumers that
  // legitimately declare a multiple reference on a non-transferable entity.
  if (entry.entity.transferable !== true) return;
  for (const [fieldName, field] of Object.entries(entry.entity.fields)) {
    if (field.type !== "reference" || field.multiple !== true) continue;
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

// Depth is measured over reference edges between transferable entities, the
// only chain that nests (parentRef is one level by construction — see
// engine/boot-validator/parent-ref.ts).
//
// `onPath` counts NODES, the limit counts EDGES: a chain of exactly
// MAX_TRANSFER_DEPTH edges holds MAX_TRANSFER_DEPTH + 1 entities, and the
// mover runs MAX_TRANSFER_DEPTH rounds of one hop each, so it still walks that
// chain whole. Rejecting it here would make a schema the mover handles
// correctly refuse to boot.
function longestTransferableChain(
  startName: string,
  bySource: ReadonlyMap<string, readonly string[]>,
  onPath: readonly string[],
): readonly string[] | undefined {
  if (onPath.length > MAX_TRANSFER_DEPTH + 1) return onPath;
  for (const target of bySource.get(startName) ?? []) {
    // skip: a cycle revisits a type already on this path, and schema depth
    // cannot measure how far it actually runs — that depends on the rows, not
    // the declaration. The mover carries this one instead, failing with
    // `transfer_graph_too_deep` when its rounds run out (#3131).
    if (onPath.includes(target)) continue;
    const deeper = longestTransferableChain(target, bySource, [...onPath, target]);
    if (deeper !== undefined) return deeper;
  }
  return undefined;
}

export function validateTransferGraph(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  for (const [name, entity] of Object.entries(feature.entities ?? {})) {
    validateNoMultipleReferenceEdge({ name, entity }, feature.name);
  }

  const transferable = new Set(
    allEntities(featureMap)
      .filter((e) => e.entity.transferable === true)
      .map((e) => e.name),
  );
  // Edges point child -> parent in the schema; the graph walks parent -> child,
  // so the lookup is inverted here.
  const childrenByParent = new Map<string, string[]>();
  for (const { name, entity } of allEntities(featureMap)) {
    if (!transferable.has(name)) continue;
    for (const target of referenceTargets(entity)) {
      if (!transferable.has(target)) continue;
      const children = childrenByParent.get(target) ?? [];
      children.push(name);
      childrenByParent.set(target, children);
    }
  }

  for (const [name, entity] of Object.entries(feature.entities ?? {})) {
    if (entity.transferable !== true) continue;
    const tooDeep = longestTransferableChain(name, childrenByParent, [name]);
    if (tooDeep !== undefined) {
      throw new Error(
        `[Kumiko TransferGraph] the transfer graph rooted at entity "${name}" is deeper than ` +
          `the ${MAX_TRANSFER_DEPTH}-level limit (feature: "${feature.name}"): ` +
          `${tooDeep.join(" -> ")}. Beyond that depth tenant-handover would move fewer rows ` +
          `than the declaration implies. Fix: flatten the chain, or drop transferable from an ` +
          `entity in it that should not move with its host.`,
      );
    }
  }
}

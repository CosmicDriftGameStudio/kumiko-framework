import { parseRefTargetEntityName } from "./parse-ref-target.js";
import type { EntityDefinition } from "./types/index.js";

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

export type TransferEdgeLink =
  | { readonly kind: "parentRef"; readonly typeField: string; readonly idField: string }
  | { readonly kind: "reference"; readonly field: string };

export type TransferEdge = {
  readonly entityName: string;
  readonly entity: EntityDefinition;
  /** The already-resolved type this edge hangs off — its moved row ids are
   *  the parent ids the mover matches this edge's rows against. */
  readonly parentEntityName: string;
  readonly link: TransferEdgeLink;
};

/** Outgoing edges per type: keyed by the type an edge hangs off, so the mover
 *  can ask "what hangs off the rows I just moved" for any type it reaches, at
 *  any depth, as often as it reaches it. */
export type TransferAdjacency = ReadonlyMap<string, readonly TransferEdge[]>;

// A `multiple` reference stores a jsonb array rather than a single id column,
// which the mover's `= ANY($ids)` match cannot address. The boot validator
// (boot-validator/transfer-graph.ts) rejects that combination on transferable
// entities, so skipping it here can only ever hit an entity that is not
// transferable — never a silent partial move.
// `handover: "stay"` is the declared opt-out: the reference crosses the tenant
// boundary after a handover on purpose, so the edge is not walked.
function referenceEdgesFrom(entityName: string, entity: EntityDefinition): TransferEdge[] {
  const edges: TransferEdge[] = [];
  for (const [fieldName, field] of Object.entries(entity.fields)) {
    if (field.type !== "reference") continue;
    if (field.multiple === true) continue;
    if (field.handover === "stay") continue;
    edges.push({
      entityName,
      entity,
      parentEntityName: parseRefTargetEntityName(field.entity),
      link: { kind: "reference", field: fieldName },
    });
  }
  return edges;
}

// A parentRef names the types it accepts; without `allowedTypes` it accepts
// any of them, so the edge is recorded against every registered type.
function parentRefEdgesFrom(
  entityName: string,
  entity: EntityDefinition,
  allEntityNames: readonly string[],
): TransferEdge[] {
  const parentRef = entity.parentRef;
  if (!parentRef) return [];
  const link: TransferEdgeLink = {
    kind: "parentRef",
    typeField: parentRef.entityTypeField,
    idField: parentRef.entityIdField,
  };
  return (parentRef.allowedTypes ?? allEntityNames).map((parentEntityName) => ({
    entityName,
    entity,
    parentEntityName,
    link,
  }));
}

// The one definition of the transfer graph, shared by the boot validator
// (depth limit) and the tenant-handover mover (traversal), so the limit that is
// checked at boot is measured over exactly the edges that are walked at claim
// time. Edges are kept for every entity, transferable or not: a
// non-transferable node in the middle of a chain is still a hop the mover
// takes before it fails the claim.
//
// A type can legitimately be reached by more than one edge — `note.vehicleId`
// and `note.campaignId` are distinct, and collapsing them by entity name would
// leave one edge's rows behind, the silent partial move #3088 exists to end.
export function resolveTransferAdjacency(
  entities: ReadonlyMap<string, EntityDefinition>,
  rootEntityType?: string,
): TransferAdjacency {
  const allEntityNames = [...entities.keys()];
  const byParent = new Map<string, TransferEdge[]>();

  for (const [entityName, entity] of entities) {
    // skip: the root is never collected as someone else's descendant. A self
    // reference would otherwise drag unrelated rows of the root's own type
    // across the tenant boundary along with the one that was claimed.
    if (entityName === rootEntityType) continue;
    for (const edge of [
      ...parentRefEdgesFrom(entityName, entity, allEntityNames),
      ...referenceEdgesFrom(entityName, entity),
    ]) {
      const edges = byParent.get(edge.parentEntityName) ?? [];
      edges.push(edge);
      byParent.set(edge.parentEntityName, edges);
    }
  }

  return byParent;
}

// `onPath` counts NODES, the limit counts EDGES: a chain of exactly
// MAX_TRANSFER_DEPTH edges holds MAX_TRANSFER_DEPTH + 1 entities, and the
// mover runs MAX_TRANSFER_DEPTH rounds of one hop each, so it still walks that
// chain whole. Returns the first path that exceeds the limit.
export function findOverDeepTransferChain(
  adjacency: TransferAdjacency,
  onPath: readonly string[],
): readonly string[] | undefined {
  if (onPath.length > MAX_TRANSFER_DEPTH + 1) return onPath;
  const startName = onPath[onPath.length - 1];
  if (startName === undefined) return undefined;
  for (const edge of adjacency.get(startName) ?? []) {
    // skip: a cycle revisits a type already on this path, and schema depth
    // cannot measure how far it actually runs — that depends on the rows, not
    // the declaration. The mover carries this one instead, failing with
    // `transfer_graph_too_deep` when its rounds run out (#3131).
    if (onPath.includes(edge.entityName)) continue;
    const deeper = findOverDeepTransferChain(adjacency, [...onPath, edge.entityName]);
    if (deeper !== undefined) return deeper;
  }
  return undefined;
}

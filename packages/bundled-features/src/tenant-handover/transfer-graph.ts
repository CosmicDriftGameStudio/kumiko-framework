// Resolves the declared transfer graph for a root entity type: the root
// itself, plus every registered entity that reaches it through a declared
// schema edge (kumiko-framework#3035, #3088; framework CLAUDE.md premise 4 —
// the graph depth is read off the existing declarations, never a hand-
// maintained per-app list).
//
// Two edge kinds carry a graph (#3088):
//   - `parentRef`, the polymorphic join-row link (entityTypeField +
//     entityIdField). One level deep by construction — the boot validator at
//     engine/boot-validator/parent-ref.ts rejects a host that itself declares
//     a parentRef.
//   - a plain `reference` field, whose `entity` names its target directly.
//     These nest freely.
//
// What comes out is static adjacency, not a walk: which edges lead away from
// each type, read straight off the declarations. The mover drives the actual
// traversal from the row ids it moves (#3131), because how deep a type sits
// depends on the rows found, not on the schema alone.
//
// `transferable: true` stays the only gate on what actually moves, and it is
// enforced by the caller against edges that turn out to have rows rather than
// here: a declaration names which types an edge accepts, never proof that any
// row currently travels it. Narrowing here would need the very query the caller
// is about to run anyway.

import {
  type EntityDefinition,
  parseRefTargetEntityName,
  type Registry,
} from "@cosmicdrift/kumiko-framework/engine";

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

export function resolveTransferableRoot(
  registry: Registry,
  entityType: string,
): EntityDefinition | undefined {
  const entity = registry.getAllEntities().get(entityType);
  return entity?.transferable === true ? entity : undefined;
}

// A `multiple` reference stores a jsonb array rather than a single id column,
// which the mover's `= ANY($ids)` match cannot address. The boot validator
// (engine/boot-validator/transfer-graph.ts) rejects that combination up front,
// so skipping it here can only ever hit an entity that is not transferable —
// never a silent partial move.
function referenceEdgesFrom(entityName: string, entity: EntityDefinition): readonly TransferEdge[] {
  const edges: TransferEdge[] = [];
  for (const [fieldName, field] of Object.entries(entity.fields)) {
    if (field.type !== "reference") continue;
    if (field.multiple === true) continue;
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
): readonly TransferEdge[] {
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

/** Outgoing edges per type: keyed by the type an edge hangs off, so the mover
 *  can ask "what hangs off the rows I just moved" for any type it reaches, at
 *  any depth, as often as it reaches it. */
export type TransferAdjacency = ReadonlyMap<string, readonly TransferEdge[]>;

// A type can legitimately be reached by more than one edge — `note.vehicleId`
// and `note.campaignId` are distinct, and collapsing them by entity name would
// leave one edge's rows behind, the silent partial move #3088 exists to end.
// Both are kept here; the mover runs each against whatever parent ids it has.
export function resolveTransferAdjacency(
  registry: Registry,
  rootEntityType: string,
): TransferAdjacency {
  const entities = registry.getAllEntities();
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

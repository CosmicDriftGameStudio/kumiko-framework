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
//     These nest freely, so the resolution below iterates level by level
//     instead of taking a single registry pass.
//
// `transferable: true` stays the only gate on what actually moves, and it is
// enforced by the caller against edges that turn out to have rows rather than
// here: a declaration names which types an edge accepts, never proof that any
// row currently travels it. Narrowing here would need the very query the caller
// is about to run anyway.

import {
  type EntityDefinition,
  MAX_TRANSFER_DEPTH,
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

function parentRefEdgeTo(
  entity: EntityDefinition,
  parentEntityName: string,
): TransferEdgeLink | undefined {
  const parentRef = entity.parentRef;
  if (!parentRef) return undefined;
  if (parentRef.allowedTypes && !parentRef.allowedTypes.includes(parentEntityName)) {
    return undefined;
  }
  return {
    kind: "parentRef",
    typeField: parentRef.entityTypeField,
    idField: parentRef.entityIdField,
  };
}

// A `multiple` reference stores a jsonb array rather than a single id column,
// which the mover's `= ANY($ids)` match cannot address. The boot validator
// (engine/boot-validator/transfer-graph.ts) rejects that combination up front,
// so skipping it here can only ever hit an entity that is not transferable —
// never a silent partial move.
function referenceEdgesTo(
  entity: EntityDefinition,
  parentEntityName: string,
): readonly TransferEdgeLink[] {
  const links: TransferEdgeLink[] = [];
  for (const [fieldName, field] of Object.entries(entity.fields)) {
    if (field.type !== "reference") continue;
    if (field.entity !== parentEntityName) continue;
    if (field.multiple === true) continue;
    links.push({ kind: "reference", field: fieldName });
  }
  return links;
}

export type TransferGraph = {
  /** Levels, outermost first. */
  readonly levels: readonly (readonly TransferEdge[])[];
  /** The edges that would have formed one level past the limit. Empty for
   *  every graph within it. The mover turns a non-empty one into a named
   *  error, but only once it knows the parent level actually moved rows —
   *  truncating here silently is the partial move #3088 exists to end, and
   *  throwing here unconditionally would fail handovers whose deep levels
   *  hold no rows at all. */
  readonly overflowEdges: readonly TransferEdge[];
};

// Every edge in level N hangs off a type resolved in level N-1, so the mover
// can feed each level the row ids the previous one returned.
//
// A type may legitimately appear in more than one level or twice in the same
// one — `note.vehicleId` and `note.campaignId` are two distinct edges, and
// de-duplicating by entity name would drop the second one's rows on the floor
// (exactly the silent partial move #3088 exists to end). Edges are therefore
// de-duplicated by (entity, parent, field), and the root is never collected as
// a child of anything, which is what bounds a reference cycle.
//
// Known limit of the level-wise walk: an edge runs at the first depth it is
// reachable at and never again, because that global de-duplication is also
// what terminates a cycle. So if a type is reachable both at depth 1 and, via
// a longer path, at depth 2, the rows found the second time get no descendants
// walked — the edges below them already ran. Closing that needs the mover to
// drive a worklist off newly-moved ids with this function supplying only the
// static adjacency, which is a different interface, not a tweak. No schema in
// the workspace declares `transferable: true` on such a shape today.
export function resolveTransferGraph(registry: Registry, rootEntityType: string): TransferGraph {
  const entities = registry.getAllEntities();
  const levels: (readonly TransferEdge[])[] = [];
  const seenEdges = new Set<string>();
  let frontier: readonly string[] = [rootEntityType];

  for (let depth = 0; depth <= MAX_TRANSFER_DEPTH && frontier.length > 0; depth++) {
    const level: TransferEdge[] = [];
    for (const parentEntityName of frontier) {
      for (const [entityName, entity] of entities) {
        if (entityName === rootEntityType) continue;
        const parentRefLink = parentRefEdgeTo(entity, parentEntityName);
        const links: readonly TransferEdgeLink[] = [
          ...(parentRefLink === undefined ? [] : [parentRefLink]),
          ...referenceEdgesTo(entity, parentEntityName),
        ];
        for (const link of links) {
          const key = `${entityName}|${parentEntityName}|${
            link.kind === "parentRef" ? link.idField : link.field
          }`;
          if (seenEdges.has(key)) continue;
          seenEdges.add(key);
          level.push({ entityName, entity, parentEntityName, link });
        }
      }
    }
    if (level.length === 0) break;
    if (depth === MAX_TRANSFER_DEPTH) return { levels, overflowEdges: level };
    levels.push(level);
    frontier = [...new Set(level.map((edge) => edge.entityName))];
  }

  return { levels, overflowEdges: [] };
}

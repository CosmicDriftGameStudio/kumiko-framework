// Resolves the declared transfer graph for a root entity type: the root
// itself, plus every registered entity that reaches it through a declared
// schema edge (kumiko-framework#3035, #3088; framework CLAUDE.md premise 4 —
// the graph depth is read off the existing declarations, never a hand-
// maintained per-app list).
//
// The edge definition (parentRef + single-valued reference fields, minus
// `handover: "stay"`) lives in the framework so the boot validator's depth
// limit and the mover's traversal measure the same graph. What comes out is
// static adjacency, not a walk: the mover drives the actual traversal from the
// row ids it moves (#3131), because how deep a type sits depends on the rows
// found, not on the schema alone.
//
// `transferable: true` stays the only gate on what actually moves, and it is
// enforced by the caller against edges that turn out to have rows rather than
// here: a declaration names which types an edge accepts, never proof that any
// row currently travels it. Narrowing here would need the very query the caller
// is about to run anyway.

import {
  type EntityDefinition,
  type Registry,
  resolveEntityTransferAdjacency,
  type TransferAdjacency,
} from "@cosmicdrift/kumiko-framework/engine";

export type {
  TransferAdjacency,
  TransferEdge,
  TransferEdgeLink,
} from "@cosmicdrift/kumiko-framework/engine";

export function resolveTransferableRoot(
  registry: Registry,
  entityType: string,
): EntityDefinition | undefined {
  const entity = registry.getAllEntities().get(entityType);
  return entity?.transferable === true ? entity : undefined;
}

export function resolveTransferAdjacency(
  registry: Registry,
  rootEntityType: string,
): TransferAdjacency {
  return resolveEntityTransferAdjacency(registry.getAllEntities(), rootEntityType);
}

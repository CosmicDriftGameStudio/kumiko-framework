// Resolves the declared transfer graph for a root entity type: the root
// itself, plus every registered entity whose `parentRef` can name it as a
// host (kumiko-framework#3035, framework CLAUDE.md premise 4 — the graph
// depth is read off the existing parentRef declaration, never a hand-
// maintained per-app list). parentRef is one level deep by construction (the
// boot validator at engine/boot-validator/parent-ref.ts rejects a host that
// itself declares a parentRef), so this resolves in one registry pass.

import type { EntityDefinition, Registry } from "@cosmicdrift/kumiko-framework/engine";

export type TransferChildCandidate = {
  readonly entityName: string;
  readonly entity: EntityDefinition;
};

export function resolveTransferableRoot(
  registry: Registry,
  entityType: string,
): EntityDefinition | undefined {
  const entity = registry.getAllEntities().get(entityType);
  return entity?.transferable === true ? entity : undefined;
}

// Broad on purpose: a candidate's `parentRef.allowedTypes` is a declaration
// of which host TYPES it accepts, not proof any row of it currently points
// at THIS root instance. The caller queries actual rows per candidate and
// only enforces `transferable` on candidates that turn out to have matching
// rows — narrowing here to "has rows" would need the very query the caller
// is about to run anyway, and would make an unrelated candidate with
// `allowedTypes: undefined` (any host) silently invisible instead of
// query-checked.
export function resolveChildCandidates(
  registry: Registry,
  rootEntityType: string,
): readonly TransferChildCandidate[] {
  const candidates: TransferChildCandidate[] = [];
  for (const [entityName, entity] of registry.getAllEntities()) {
    const parentRef = entity.parentRef;
    if (!parentRef) continue;
    if (parentRef.allowedTypes && !parentRef.allowedTypes.includes(rootEntityType)) continue;
    candidates.push({ entityName, entity });
  }
  return candidates;
}

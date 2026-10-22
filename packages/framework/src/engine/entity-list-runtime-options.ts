import type { ListRuntimeOptions } from "@cosmicdrift/kumiko-types/event-store-executor-types";
import type { EagerLoadEntityResolver, EagerLoadViewer } from "../db/eagerload.ts";
import type { HandlerContext, SessionUser } from "./types/index.ts";

// Registry access only exists at request time, so the searchable/sortable-reference
// caches, the entity resolver and the join-row read gate travel through the
// runtime-override extension point of the executor verbs.
export function entityListRuntime(
  ctx: HandlerContext,
  entityName: string,
  user: SessionUser,
): {
  readonly runtimeOptions: ListRuntimeOptions;
  readonly eagerLoadViewer: EagerLoadViewer;
  readonly resolveEntity: EagerLoadEntityResolver;
} {
  const parentVisibility = { entities: ctx.registry.getAllEntities() };
  const resolveEntity = (name: string) => ctx.registry.getEntity(name);
  return {
    runtimeOptions: {
      ...(ctx.searchAdapter !== undefined && { searchAdapter: ctx.searchAdapter }),
      ...(ctx.includeDeleted === true && { includeDeleted: true }),
      referenceSearch: { fields: ctx.registry.getSearchableReferences(entityName), resolveEntity },
      referenceSort: { fields: ctx.registry.getSortableReferences(entityName), resolveEntity },
      parentVisibility,
    },
    eagerLoadViewer: { user, parentVisibility },
    resolveEntity,
  };
}

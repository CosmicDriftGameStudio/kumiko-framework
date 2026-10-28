import type { AggregateKey } from "@cosmicdrift/kumiko-types/aggregate-types";
import type { ListRuntimeOptions } from "@cosmicdrift/kumiko-types/event-store-executor-types";
import type { EagerLoadEntityResolver, EagerLoadViewer } from "../db/eagerload.ts";
import { resolveTableName } from "../db/entity-table-meta.ts";
import { labelListAggregateGroups } from "../db/list-aggregate-labels.ts";
import type { TenantDb } from "../db/tenant-db.ts";
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
      ...(ctx.services.searchAdapter !== undefined && {
        searchAdapter: ctx.services.searchAdapter,
      }),
      ...(ctx.includeDeleted === true && { includeDeleted: true }),
      referenceSearch: { fields: ctx.registry.getSearchableReferences(entityName), resolveEntity },
      referenceSort: { fields: ctx.registry.getSortableReferences(entityName), resolveEntity },
      parentVisibility,
    },
    eagerLoadViewer: { user, parentVisibility },
    resolveEntity,
  };
}

// Resolved through the viewer's read access, like list-aggregate labels; non-entity sources yield none.
export async function referenceGroupLabels(
  ctx: HandlerContext,
  user: SessionUser,
  sourceTableName: string,
  groupByField: string,
  keys: readonly AggregateKey[],
  db: TenantDb,
): Promise<ReadonlyMap<string, string>> {
  const labels = new Map<string, string>();
  const owner = [...ctx.registry.getAllEntities()].find(
    ([entityName, entity]) => resolveTableName(entityName, entity, undefined) === sourceTableName,
  );
  if (owner === undefined || keys.length === 0) return labels;
  const [entityName, entity] = owner;
  const { eagerLoadViewer, resolveEntity } = entityListRuntime(ctx, entityName, user);
  const labeled = await labelListAggregateGroups(
    { groups: keys.map((key) => ({ key, count: 0, measures: [] })) },
    groupByField,
    { entity, resolveEntity, viewer: eagerLoadViewer },
    db,
  );
  for (const group of labeled.groups) {
    if (group.key !== null && group.label != null && group.label !== "") {
      labels.set(String(group.key), group.label);
    }
  }
  return labels;
}

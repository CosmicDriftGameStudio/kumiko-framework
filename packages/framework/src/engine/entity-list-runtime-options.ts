import type { AggregateKey } from "@cosmicdrift/kumiko-types/aggregate-types";
import type {
  ListRuntimeOptions,
  ParentVisibilityOption,
} from "@cosmicdrift/kumiko-types/event-store-executor-types";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { AccessRule } from "@cosmicdrift/kumiko-types/handlers";
import { collectEntityDetailAccess, collectEntityReadAccess } from "../api/entity-read-access.ts";
import type { EagerLoadEntityResolver, EagerLoadViewer } from "../db/eagerload.ts";
import { resolveTableName } from "../db/entity-table-meta.ts";
import { labelListAggregateGroups } from "../db/list-aggregate-labels.ts";
import { buildEntityTable } from "../db/table-builder.ts";
import { extractTableInfo } from "../db/table-info.ts";
import type { TenantDb } from "../db/tenant-db.ts";
import { hasAccess } from "./access.ts";
import { IMPLICIT_PROJECTION_SUFFIX } from "./registry-state.ts";
import type { HandlerContext, Registry, SessionUser } from "./types/index.ts";

// The rules only change with the registry, so they are collected once, not per request.
const readAccessByRegistry = new WeakMap<Registry, ReadonlyMap<string, readonly AccessRule[]>>();

const detailAccessByRegistry = new WeakMap<Registry, ReadonlyMap<string, AccessRule>>();

function detailAccessOf(registry: Registry): ReadonlyMap<string, AccessRule> {
  let rules = detailAccessByRegistry.get(registry);
  if (rules === undefined) {
    rules = collectEntityDetailAccess(registry);
    detailAccessByRegistry.set(registry, rules);
  }
  return rules;
}

function readAccessOf(registry: Registry): ReadonlyMap<string, readonly AccessRule[]> {
  let rules = readAccessByRegistry.get(registry);
  if (rules === undefined) {
    rules = collectEntityReadAccess(registry);
    readAccessByRegistry.set(registry, rules);
  }
  return rules;
}

// An entity with a backingTable is read from that table; the implicit projection holds it.
function readTableOf(ctx: HandlerContext, entityName: string, entity: EntityDefinition) {
  const implicit = ctx.registry
    .getProjectionsForSource(entityName)
    .find((projection) =>
      projection.name.endsWith(`:projection:${entityName}${IMPLICIT_PROJECTION_SUFFIX}`),
    );
  return implicit?.table ?? buildEntityTable(entityName, entity);
}

// The join-row and read gates resolve hosts and file owners against the registry, which only
// exists at request time; the handler check is the one live signals use too.
export function parentVisibilityFor(
  ctx: HandlerContext,
  user: SessionUser,
): ParentVisibilityOption {
  const detailRules = detailAccessOf(ctx.registry);
  return {
    entities: ctx.registry.getAllEntities(),
    canReadEntity: (name) => {
      const rule = detailRules.get(name);
      return rule !== undefined && hasAccess(user, rule);
    },
    resolveTable: (name) => {
      const entity = ctx.registry.getEntity(name);
      if (entity === undefined) throw new Error(`parentVisibility: unknown entity "${name}"`);
      return readTableOf(ctx, name, entity);
    },
  };
}

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
  const parentVisibility = parentVisibilityFor(ctx, user);
  const resolveEntity = (name: string) => ctx.registry.getEntity(name);
  const resolveTable = (name: string) => {
    const entity = ctx.registry.getEntity(name);
    if (entity === undefined) throw new Error(`entityListRuntime: unknown entity "${name}"`);
    return readTableOf(ctx, name, entity);
  };
  const readRules = readAccessOf(ctx.registry);
  return {
    runtimeOptions: {
      ...(ctx.services.searchAdapter !== undefined && {
        searchAdapter: ctx.services.searchAdapter,
      }),
      ...(ctx.includeDeleted === true && { includeDeleted: true }),
      referenceSearch: {
        fields: ctx.registry.getSearchableReferences(entityName),
        resolveEntity,
        resolveTable,
      },
      referenceSort: {
        fields: ctx.registry.getSortableReferences(entityName),
        resolveEntity,
        resolveTable,
      },
      parentVisibility,
      derivedSql: {
        resolveEntity,
        resolveTable,
        canReadEntity: (name) => (readRules.get(name) ?? []).some((rule) => hasAccess(user, rule)),
        today: ctx.tz.today(ctx.tz.tenant).toString(),
        now: ctx.tz.now().toString(),
      },
    },
    eagerLoadViewer: { user, parentVisibility, resolveTable },
    resolveEntity,
  };
}

// An entity with a backingTable reads and writes that table, whose name the entity's own
// `table` does not say; the implicit projection holds the table the executor really uses.
function physicalReadTableName(
  ctx: HandlerContext,
  entityName: string,
  entity: EntityDefinition,
): string {
  const implicit = ctx.registry
    .getProjectionsForSource(entityName)
    .find((projection) =>
      projection.name.endsWith(`:projection:${entityName}${IMPLICIT_PROJECTION_SUFFIX}`),
    );
  return implicit !== undefined
    ? extractTableInfo(implicit.table).name
    : resolveTableName(entityName, entity, undefined);
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
    ([entityName, entity]) => physicalReadTableName(ctx, entityName, entity) === sourceTableName,
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

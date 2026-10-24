import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type {
  ListAggregateGroup,
  ListAggregateResult,
} from "@cosmicdrift/kumiko-types/list-aggregate-types";

import type { EagerLoadEntityResolver, EagerLoadViewer } from "./eagerload.ts";
import { enrichWithReferences } from "./eagerload.ts";
import type { EventStoreExecutor } from "./event-store-executor.ts";
import type { TenantDb } from "./tenant-db.ts";

type LabelDeps = {
  readonly entity: EntityDefinition;
  readonly resolveEntity: EagerLoadEntityResolver;
  readonly viewer: EagerLoadViewer;
};

function labelOf(ref: unknown, labelField: string): string | null {
  if (typeof ref !== "object" || ref === null || Array.isArray(ref)) return null;
  const value = Reflect.get(ref, labelField);
  return typeof value === "string" ? value : null;
}

// Labels come from the same eager-load path as list rows, so they carry its
// ownership and field-read gating instead of a second label query.
export async function labelListAggregateGroups(
  result: ListAggregateResult,
  groupByField: string | undefined,
  deps: LabelDeps,
  db: TenantDb,
): Promise<ListAggregateResult> {
  if (groupByField === undefined || result.groups.length === 0) return result;
  const def = deps.entity.fields[groupByField];
  if (def?.type !== "reference" || def.multiple === true) return result;

  const enriched = await enrichWithReferences(
    result.groups.map((g) => ({ [groupByField]: g.key })),
    deps.entity,
    deps.resolveEntity,
    db,
    deps.viewer,
  );
  const groups = result.groups.map((group, i): ListAggregateGroup => {
    const ref = Reflect.get(enriched[i]?.["_refs"] ?? {}, groupByField);
    return { ...group, label: labelOf(ref, def.labelField ?? "id") };
  });
  return { ...result, groups };
}

type AggregateRequest = Parameters<EventStoreExecutor["aggregate"]>[0];

export async function answerListAggregate(
  executor: Pick<EventStoreExecutor, "aggregate">,
  request: AggregateRequest,
  user: Parameters<EventStoreExecutor["aggregate"]>[1],
  db: TenantDb,
  runtimeOptions: Parameters<EventStoreExecutor["aggregate"]>[3],
  labelDeps: LabelDeps,
): Promise<ListAggregateResult> {
  const result = await executor.aggregate(request, user, db, runtimeOptions);
  return labelListAggregateGroups(result, request.aggregate.groupBy, labelDeps, db);
}

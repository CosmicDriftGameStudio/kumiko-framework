import type { DbTx } from "@cosmicdrift/kumiko-types/db-connection";
import type { EntityTableMeta } from "@cosmicdrift/kumiko-types/entity-table-meta-types";
import type { WritableTable } from "@cosmicdrift/kumiko-types/executor-brand";
import type { DbConnection } from "../db/connection.ts";
import { lockEventConsumersShareMode } from "../db/queries/event-consumer.ts";
import { aggregateWhere, deleteMany, transaction } from "../db/query.ts";
import { runInSystemRowLevelSecurityScope } from "../db/row-level-security-scope.ts";
import { tableExists } from "../db/schema-inspection.ts";
import { asEntityTableMeta, tableNameOf } from "../db/table-introspection.ts";
import { withExecutorManagedWrites } from "../db/tenant-db.ts";
import type { Registry } from "../engine/types/feature.ts";
import { archivedStreamsTable } from "../event-store/archive.ts";
import { eventsTable } from "../event-store/events-schema.ts";
import { rebuildDeadLetterTable } from "../event-store/rebuild-dead-letter.ts";
import { snapshotsTable } from "../event-store/snapshot.ts";
import { upcasterDeadLetterTable } from "../event-store/upcaster-dead-letter.ts";

// Whole-type removal for aggregate types that must not survive in the event log, e.g. old events
// that no longer replay into their projection (a column became NOT NULL) and block
// `schema apply`. pruneEvents (event-retention.ts) cannot do this: it is age-bound, events-only
// and refuses while a consumer lags. Here the lag is ignored on purpose, because the removed
// types leave the log entirely and no consumer has anything left to deliver for them.

export class AggregateTypeRemovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AggregateTypeRemovalError";
  }
}

export type AggregateTypeStats = {
  readonly aggregateType: string;
  readonly events: number;
  readonly aggregates: number;
  readonly tenants: number;
};

export type WipedProjection = {
  readonly projection: string;
  readonly table: EntityTableMeta;
};

export type AggregateTypeRemovalPlan = {
  readonly stats: readonly AggregateTypeStats[];
  readonly wipedProjections: readonly WipedProjection[];
};

export type AggregateTypeRemovalDeleted = {
  readonly events: number;
  readonly snapshots: number;
  readonly archivedStreams: number;
  readonly upcasterDeadLetters: number;
  readonly rebuildDeadLetters: number;
  readonly projectionRows: Readonly<Record<string, number>>;
};

export type AggregateTypeRemovalResult = {
  readonly plan: AggregateTypeRemovalPlan;
  // Absent on a dry run.
  readonly deleted?: AggregateTypeRemovalDeleted;
};

type CountRunner = Parameters<typeof aggregateWhere>[0];

async function countDistinct(
  db: CountRunner,
  field: "aggregateId" | "tenantId",
  aggregateType: string,
): Promise<number> {
  const rows = await aggregateWhere(
    db,
    eventsTable,
    { measure: { fn: "countDistinct", field } },
    { aggregateType },
  );
  return rows[0]?.value ?? 0;
}

async function countEvents(db: CountRunner, aggregateType: string): Promise<number> {
  const rows = await aggregateWhere(
    db,
    eventsTable,
    { measure: { fn: "count" } },
    { aggregateType },
  );
  return rows[0]?.value ?? 0;
}

async function statsOf(db: CountRunner, aggregateType: string): Promise<AggregateTypeStats> {
  return {
    aggregateType,
    events: await countEvents(db, aggregateType),
    aggregates: await countDistinct(db, "aggregateId", aggregateType),
    tenants: await countDistinct(db, "tenantId", aggregateType),
  };
}

// "app-release.created" -> "app-release"; qualified names without a dot carry no aggregate type.
function aggregateTypeOfEventType(eventType: string): string | undefined {
  const dot = eventType.indexOf(".");
  return dot === -1 ? undefined : eventType.slice(0, dot);
}

type FeedClass = "untouched" | "wipe" | "mixed";

// A projection fed only by removed types would be rebuilt to empty, so its rows are deleted. One
// that also reads other types would keep rows from the removed ones until a rebuild; guessing
// which rows belong to which type is not possible (row ids are projection-specific), so the
// whole run refuses instead of leaving ghost rows that the next rebuild aborts on.
function classifyFeed(involved: ReadonlySet<string>, removed: ReadonlySet<string>): FeedClass {
  const touched = [...involved].filter((type) => removed.has(type));
  if (touched.length === 0) return "untouched";
  return touched.length === involved.size ? "wipe" : "mixed";
}

function tableMetaOrThrow(table: unknown, owner: string): EntityTableMeta {
  const meta = asEntityTableMeta(table);
  if (meta === undefined) {
    throw new AggregateTypeRemovalError(
      `"${owner}" has a table (${tableNameOf(table)}) without table metadata; cannot remove its rows.`,
    );
  }
  return meta;
}

function planProjections(
  registry: Registry,
  removed: ReadonlySet<string>,
): readonly WipedProjection[] {
  const wiped: WipedProjection[] = [];
  const refused: string[] = [];
  const consider = (name: string, involved: Set<string>, table: unknown) => {
    const feed = classifyFeed(involved, removed);
    if (feed === "mixed") refused.push(`${name} (${[...involved].sort().join(", ")})`);
    if (feed === "wipe") wiped.push({ projection: name, table: tableMetaOrThrow(table, name) });
  };

  for (const [name, def] of registry.getAllProjections()) {
    const involved = new Set<string>([
      ...(Array.isArray(def.source) ? def.source : [def.source]),
      ...(def.extraSources ?? []),
    ]);
    consider(name, involved, def.table);
  }
  for (const [name, def] of registry.getAllMultiStreamProjections()) {
    if (def.table === undefined) continue;
    const involved = new Set<string>();
    for (const eventType of Object.keys(def.apply)) {
      const type = aggregateTypeOfEventType(eventType);
      if (type !== undefined) involved.add(type);
    }
    consider(name, involved, def.table);
  }
  if (refused.length > 0) {
    throw new AggregateTypeRemovalError(
      `Refusing: these projections are fed by removed AND other aggregate types, so their rows cannot be ` +
        `split by type: ${refused.join("; ")}. Nothing was deleted.`,
    );
  }
  return wiped;
}

async function assertTypesKnown(
  registry: Registry,
  stats: readonly AggregateTypeStats[],
): Promise<void> {
  const unknown = stats
    .filter((s) => s.events === 0 && !registry.getAllEntities().has(s.aggregateType))
    .map((s) => s.aggregateType);
  if (unknown.length > 0) {
    throw new AggregateTypeRemovalError(
      `Unknown aggregate type(s): ${unknown.join(", ")} (no registered entity and no events). Nothing was deleted.`,
    );
  }
}

async function planRemoval(
  db: CountRunner,
  registry: Registry,
  types: readonly string[],
): Promise<AggregateTypeRemovalPlan> {
  const stats: AggregateTypeStats[] = [];
  for (const type of types) stats.push(await statsOf(db, type));
  await assertTypesKnown(registry, stats);
  return { stats, wipedProjections: planProjections(registry, new Set(types)) };
}

async function deleteIfPresent(
  tx: DbTx,
  table: WritableTable,
  tableName: string,
  types: readonly string[],
): Promise<number> {
  // Dead-letter and archive tables are created lazily, so a fresh database may not have them.
  if (!(await tableExists(tx, `public.${tableName}`))) return 0;
  return deleteMany(tx, table, { aggregateType: [...types] });
}

async function applyRemoval(
  tx: DbTx,
  plan: AggregateTypeRemovalPlan,
  types: readonly string[],
): Promise<AggregateTypeRemovalDeleted> {
  const projectionRows: Record<string, number> = {};
  const managed = withExecutorManagedWrites(tx);
  for (const { projection, table } of plan.wipedProjections) {
    projectionRows[projection] = await deleteMany(managed, table, {});
  }
  return {
    events: await deleteMany(tx, eventsTable, { aggregateType: [...types] }),
    snapshots: await deleteIfPresent(tx, snapshotsTable, "kumiko_snapshots", types),
    archivedStreams: await deleteIfPresent(
      tx,
      archivedStreamsTable,
      "kumiko_archived_streams",
      types,
    ),
    upcasterDeadLetters: await deleteIfPresent(
      tx,
      upcasterDeadLetterTable,
      "kumiko_upcaster_dead_letters",
      types,
    ),
    rebuildDeadLetters: await deleteIfPresent(
      tx,
      rebuildDeadLetterTable,
      "kumiko_rebuild_dead_letters",
      types,
    ),
    projectionRows,
  };
}

export type RemoveAggregateTypesOptions = {
  readonly types: readonly string[];
  readonly apply: boolean;
};

export async function removeAggregateTypes(
  db: DbConnection,
  registry: Registry,
  options: RemoveAggregateTypesOptions,
): Promise<AggregateTypeRemovalResult> {
  if (options.types.length === 0 || options.types.some((type) => type.length === 0)) {
    throw new AggregateTypeRemovalError("At least one non-empty aggregate type is required.");
  }
  return runInSystemRowLevelSecurityScope(
    "aggregate type removal deletes the events and read rows of all tenants",
    () =>
      transaction(db, async (tx) => {
        if (options.apply) {
          // Same lock as pruneEvents: no consumer may bootstrap or advance its cursor between the
          // plan and the delete.
          await lockEventConsumersShareMode(tx);
        }
        const plan = await planRemoval(tx, registry, options.types);
        if (!options.apply) return { plan };
        return { plan, deleted: await applyRemoval(tx, plan, options.types) };
      }),
  );
}

// Test-only ES-bypass: seed / mutate a managed projection directly, skipping
// the event log. Production code cannot do this: the write helpers only accept
// a runner carrying the executor capability or a Writable table. Tests seed
// read-model state to arrange a scenario without driving the full event path;
// a projection rebuild is not part of the test lifecycle, so eventless writes
// are safe here. The signatures mirror the query helpers so a call-site
// migration is a plain identifier rename.

import type { EntityTable, EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import {
  deleteMany,
  insertMany,
  insertOne,
  updateMany,
  type WhereObject,
} from "@cosmicdrift/kumiko-framework/db";
import type { AnyDb } from "@cosmicdrift/kumiko-framework/internal/stack-support";
import {
  executorManagedEntitySourceOf,
  withExecutorManagedWritesForTests,
} from "@cosmicdrift/kumiko-framework/internal/testing";

type SeedTable = EntityTable | EntityTableMeta;

export type SeedOptions = {
  // Writes or changes a projection row of an event-sourced entity without its event, on purpose
  // (legacy, drift or corrupt-row scenarios). The reason names the scenario.
  readonly projectionOnly?: string;
};

type SeedHelperName = "seedRow" | "seedRows" | "updateRows" | "deleteRows";

const EVENT_STORE_REPLACEMENT: Readonly<Record<SeedHelperName, string>> = {
  seedRow: "seedRowViaEventStore",
  seedRows: "seedRowsViaEventStore",
  updateRows: "updateRowViaEventStore",
  deleteRows: "deleteRowViaEventStore",
};

// A row seeded or changed on an event-sourced entity table has no event, so a rebuild undoes
// it. The entity-source registry sees tables the guard's file-local scan cannot (imported ones).
function assertSeedable(
  table: SeedTable,
  options: SeedOptions | undefined,
  helper: SeedHelperName,
): void {
  const isEventSourced = executorManagedEntitySourceOf(table) !== undefined;
  const hasProjectionOnlyReason =
    options?.projectionOnly !== undefined && options.projectionOnly.trim() !== "";
  if (isEventSourced && !hasProjectionOnlyReason) {
    throw new Error(
      `${helper} on an event-sourced entity table writes the projection without its event: use ${EVENT_STORE_REPLACEMENT[helper]}, or pass { projectionOnly: reason } for a deliberate event-less row`,
    );
  }
}

export function seedRow<TRow = unknown>(
  db: AnyDb,
  table: SeedTable,
  values: Record<string, unknown>,
  options?: SeedOptions,
): Promise<TRow | undefined> {
  assertSeedable(table, options, "seedRow");
  return insertOne<TRow>(withExecutorManagedWritesForTests(db), table, values);
}

export function seedRows<TRow = unknown>(
  db: AnyDb,
  table: SeedTable,
  rows: ReadonlyArray<Record<string, unknown>>,
  options?: SeedOptions,
): Promise<readonly TRow[]> {
  assertSeedable(table, options, "seedRows");
  return insertMany<TRow>(withExecutorManagedWritesForTests(db), table, rows);
}

export function updateRows<TRow = unknown>(
  db: AnyDb,
  table: SeedTable,
  set: Record<string, unknown>,
  where: WhereObject,
  options?: SeedOptions,
): Promise<readonly TRow[]> {
  assertSeedable(table, options, "updateRows");
  return updateMany<TRow>(withExecutorManagedWritesForTests(db), table, set, where);
}

export function deleteRows(
  db: AnyDb,
  table: SeedTable,
  where: WhereObject,
  options?: SeedOptions,
): Promise<number> {
  assertSeedable(table, options, "deleteRows");
  return deleteMany(withExecutorManagedWritesForTests(db), table, where);
}

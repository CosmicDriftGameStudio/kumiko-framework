import { getTableName, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { drizzle } from "drizzle-orm/postgres-js";
import { tableExists } from "../db/schema-inspection";
import { buildDrizzleTable, toTableName } from "../db/table-builder";
import type { TestStack } from "./test-stack";

/**
 * Syncs a Drizzle table to the database via drizzle-kit migration.
 * No manual SQL — Drizzle generates CREATE/ALTER TABLE statements.
 * Strict: raises a postgres `relation already exists` (42P07) error if
 * the table is already there. Use `ensureEntityTable` for idempotent
 * boot paths.
 */
export async function createEntityTable(
  db: ReturnType<typeof drizzle>,
  entity: import("../engine/types").EntityDefinition,
  entityName?: string,
): Promise<void> {
  const table = buildDrizzleTable(entityName ?? "entity", entity);
  await pushTables(db, { [entityName ?? "entity"]: table });
}

/**
 * Idempotent variant of `createEntityTable`: checks whether the entity's
 * table already exists and skips creation if so. Schema-drift is *not*
 * detected — if the table is there but has the wrong columns, that's
 * the caller's problem (the dev-server contract is "drop the DB by
 * hand when you change the schema"). Tests should use
 * `createEntityTable` instead, since they rely on fresh DBs.
 */
export async function ensureEntityTable(
  db: ReturnType<typeof drizzle>,
  entity: import("../engine/types").EntityDefinition,
  entityName?: string,
): Promise<boolean> {
  const resolvedName = entity.table ?? toTableName(entityName ?? "entity");
  if (await tableExists(db, `public.${resolvedName}`)) return false;
  await createEntityTable(db, entity, entityName);
  return true;
}

/**
 * Pushes Drizzle table definitions to the database.
 * Uses drizzle-kit's generateDrizzleJson + generateMigration to produce SQL,
 * then executes it. Same SQL that `drizzle-kit push` would generate.
 *
 * @param prevTables - Previous table definitions (for ALTER TABLE scenarios).
 *                     If omitted, assumes empty DB (CREATE TABLE).
 */
export async function pushTables(
  db: ReturnType<typeof drizzle>,
  tables: Record<string, unknown>,
  prevTables?: Record<string, unknown>,
): Promise<void> {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const prevJson = generateDrizzleJson(prevTables ?? {});
  const targetJson = generateDrizzleJson(tables);
  const statements = await generateMigration(prevJson, targetJson);
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt));
  }
}

/**
 * Wipes event store + framework-state + the given feature read-models in
 * one TRUNCATE, then re-registers the event-consumer state rows. Used in
 * test beforeEach-hooks to return the stack to a clean slate without
 * rebuilding it.
 *
 * Fixed list of framework tables (kumiko_events, kumiko_event_consumers,
 * kumiko_archived_streams, kumiko_snapshots, kumiko_projections) is always
 * included — any event-sourced test setup needs those cleared. The
 * `extraTables` arg covers the feature's own read-model tables that would
 * otherwise accumulate rows across tests.
 *
 * Accepts either a Drizzle PgTable (for locally-defined tables: getTableName
 * extracts the SQL name) or a plain string (for SQL names whose Drizzle
 * reference lives in another module and importing it for the TRUNCATE
 * alone would be overkill). Both round-trip to the same TRUNCATE list.
 *
 * Pre-existing code duplicates this block 30+ times, each with its own
 * list of extras. The helper collapses that to a one-liner per test and
 * lets a future change to the framework-table set (e.g. adding a new
 * consumer-state table) ripple through without touching every suite.
 */
export async function resetEventStore(
  stack: TestStack,
  extraTables: readonly (PgTable | string)[] = [],
): Promise<void> {
  const frameworkTables = [
    "kumiko_events",
    "kumiko_event_consumers",
    "kumiko_archived_streams",
    "kumiko_snapshots",
    "kumiko_projections",
  ];
  const extraNames = extraTables.map((t) => (typeof t === "string" ? t : getTableName(t)));
  const allTables = [...frameworkTables, ...extraNames];
  await stack.db.execute(sql.raw(`TRUNCATE ${allTables.join(", ")} RESTART IDENTITY CASCADE`));
  if (stack.eventDispatcher) {
    await stack.eventDispatcher.ensureRegistered();
  }
}

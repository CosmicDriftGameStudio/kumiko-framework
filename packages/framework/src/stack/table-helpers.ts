import { getTableName, sql } from "drizzle-orm";

// drizzle-kit/api wird LAZY geladen — nur bei Bedarf importiert. drizzle-kit
// ist post-Phase-5 ein devDependency; Production-Apps die runProdApp nutzen
// rufen unsafePushTables nicht zur Runtime auf (Tests/dev-server-bootstrap
// only). Wenn jemand das in production aufruft → klare Fehlermeldung statt
// silent-resolution-failure. Lazy-import via dynamic import() im Funktions-
// Body ist Bun-kompatibel + TS-erlaubt.
async function loadDrizzleKitApi(): Promise<{
  generateDrizzleJson: (tables: Record<string, unknown>) => unknown;
  generateMigration: (prev: unknown, next: unknown) => Promise<readonly string[]>;
}> {
  try {
    return (await import("drizzle-kit/api")) as unknown as {
      generateDrizzleJson: (tables: Record<string, unknown>) => unknown;
      generateMigration: (prev: unknown, next: unknown) => Promise<readonly string[]>;
    };
  } catch (e) {
    throw new Error(
      "unsafePushTables() requires drizzle-kit (devDependency for test/dev-server setup). " +
        "Production apps should not reach this code path — use `kumiko schema apply` for migrations.",
    );
  }
}
import type { PgTable } from "drizzle-orm/pg-core";
import type { drizzle } from "drizzle-orm/postgres-js";
import { tableExists } from "../db/schema-inspection";
import { buildDrizzleTable, toTableName } from "../db/table-builder";
import type { TestStack } from "./test-stack";

/**
 * Bypass: creates a Drizzle table directly, without registering it as
 * a projection of the event-sourcing engine. Apps should declare data
 * via `r.entity(...)` and get tables, migrations, snapshots and audit
 * for free — this helper is reserved for framework-internal meta-tables
 * (event-store, snapshots, projection-state) and test setup.
 *
 * Strict: raises a postgres `relation already exists` (42P07) error if
 * the table is already there. Use `unsafeEnsureEntityTable` for the
 * idempotent boot-path variant.
 */
export async function unsafeCreateEntityTable(
  db: ReturnType<typeof drizzle>,
  entity: import("../engine/types").EntityDefinition,
  entityName?: string,
): Promise<void> {
  const table = buildDrizzleTable(entityName ?? "entity", entity);
  await unsafePushTables(db, { [entityName ?? "entity"]: table });
}

/**
 * Bypass (idempotent): same caveat as `unsafeCreateEntityTable` —
 * apps declare data via `r.entity(...)`. Checks whether the entity's
 * table already exists and skips creation if so. Schema-drift is *not*
 * detected: if the table is there but has the wrong columns, that's
 * the caller's problem (the dev-server contract is "drop the DB by
 * hand when you change the schema"). Tests should use
 * `unsafeCreateEntityTable` instead, since they rely on fresh DBs.
 */
export async function unsafeEnsureEntityTable(
  db: ReturnType<typeof drizzle>,
  entity: import("../engine/types").EntityDefinition,
  entityName?: string,
): Promise<boolean> {
  const resolvedName = entity.table ?? toTableName(entityName ?? "entity");
  if (await tableExists(db, `public.${resolvedName}`)) return false;
  await unsafeCreateEntityTable(db, entity, entityName);
  return true;
}

/**
 * Bypass: pushes Drizzle table definitions to the database directly.
 * Uses drizzle-kit's generateDrizzleJson + generateMigration to produce SQL,
 * then executes it. Same SQL that `drizzle-kit push` would generate.
 * Reserved for framework-internal meta-tables (event-store, projections,
 * consumer-state) and test setup — apps declare data via `r.entity(...)`.
 *
 * @param prevTables - Previous table definitions (for ALTER TABLE scenarios).
 *                     If omitted, assumes empty DB (CREATE TABLE).
 */
export async function unsafePushTables(
  db: ReturnType<typeof drizzle>,
  tables: Record<string, unknown>,
  prevTables?: Record<string, unknown>,
): Promise<void> {
  const api = await loadDrizzleKitApi();
  const prevJson = api.generateDrizzleJson(prevTables ?? {});
  const targetJson = api.generateDrizzleJson(tables);
  const statements = await api.generateMigration(prevJson, targetJson);
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

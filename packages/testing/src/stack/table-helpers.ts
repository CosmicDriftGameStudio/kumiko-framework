// @runtime dev
import {
  schemaTableName,
  truncateTablesRestartIdentity,
} from "@cosmicdrift/kumiko-framework/internal/stack-support";
import type { EventDispatcher } from "@cosmicdrift/kumiko-framework/pipeline";

function tableNameOf(table: unknown): string {
  if (typeof table !== "object" || table === null) {
    throw new Error("table-helpers: table is not a SchemaTable object");
  }
  const symbolName = schemaTableName(table);
  if (symbolName !== undefined) return symbolName;
  if ("tableName" in table && typeof table.tableName === "string") return table.tableName;
  throw new Error("table-helpers: table has no name");
}

/**
 * Wipes event store + framework-state + the given feature read-models in
 * one TRUNCATE, then re-registers the event-consumer state rows. Used in
 * test beforeEach-hooks to return the stack to a clean slate without
 * rebuilding it.
 */
export async function resetEventStore(
  stack: { db: unknown; eventDispatcher?: EventDispatcher },
  extraTables: readonly (unknown | string)[] = [],
): Promise<void> {
  const frameworkTables = [
    "kumiko_events",
    "kumiko_event_consumers",
    "kumiko_archived_streams",
    "kumiko_snapshots",
    "kumiko_projections",
  ];
  const extraNames = extraTables.map((t) => (typeof t === "string" ? t : tableNameOf(t)));
  const truncateAndReregister = async (): Promise<void> => {
    await truncateTablesRestartIdentity(stack.db, [...frameworkTables, ...extraNames]);
    await stack.eventDispatcher?.ensureRegistered();
  };
  // The dispatcher's own timer/LISTEN must not start a pass between the
  // TRUNCATE and the consumer re-registration, so they are paused for the whole reset.
  if (stack.eventDispatcher) {
    await stack.eventDispatcher.withBackgroundPassesPaused(truncateAndReregister);
  } else {
    await truncateAndReregister();
  }
}

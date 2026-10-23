import type {
  ExecutorManagedWriteCapability,
  Writable,
} from "@cosmicdrift/kumiko-types/executor-brand";
import type { EntityDefinition } from "../engine/types/index.ts";
import { AccessDeniedError, InternalError } from "../errors/index.ts";
import { asEntityTableMeta, tableNameOf } from "./table-introspection.ts";

export type ExecutorManagedEntitySource = {
  readonly entityName: string;
  readonly entity: EntityDefinition;
};

const executorManagedTables = new WeakSet<object>();
const executorManagedWriteRunners = new WeakSet<object>();
const entitySourceByTable = new WeakMap<object, ExecutorManagedEntitySource>();

// Projection tables (r.projection) have no entity source; only entity tables can take a created event.
export function markExecutorManagedTable(
  table: object,
  entitySource?: ExecutorManagedEntitySource,
): void {
  executorManagedTables.add(table);
  const meta = asEntityTableMeta(table);
  if (meta !== undefined) executorManagedTables.add(meta);
  if (entitySource !== undefined) entitySourceByTable.set(table, entitySource);
}

export function executorManagedEntitySourceOf(
  table: unknown,
): ExecutorManagedEntitySource | undefined {
  if (typeof table !== "object" || table === null) return undefined;
  return entitySourceByTable.get(table);
}

export function isExecutorManagedTable(table: unknown): boolean {
  if (typeof table !== "object" || table === null) return false;
  if (executorManagedTables.has(table)) return true;
  const meta = asEntityTableMeta(table);
  return meta !== undefined && executorManagedTables.has(meta);
}

export function registerExecutorManagedWriteRunner(runner: object): void {
  executorManagedWriteRunners.add(runner);
}

// WeakSet.has never reads a property off runner, so a fail-closed guard Proxy stays untouched.
// Bun.SQL clients are callable (tagged templates), so a runner can be a function.
export function hasExecutorManagedWriteCapability(
  runner: unknown,
): runner is ExecutorManagedWriteCapability {
  if (typeof runner !== "object" && typeof runner !== "function") return false;
  return runner !== null && executorManagedWriteRunners.has(runner);
}

export function executorManagedWriteDenied(
  runner: unknown,
  table: unknown,
  operation: string,
): AccessDeniedError | undefined {
  if (!isExecutorManagedTable(table)) return undefined;
  if (hasExecutorManagedWriteCapability(runner)) return undefined;
  const tableName = tableNameOf(table);
  return new AccessDeniedError({
    message:
      `${operation}(${tableName}): "${tableName}" is fed by events (r.entity / r.projection). ` +
      "Write it through the entity executor (r.crud, ctx.write, createEventStoreExecutor) or inside a " +
      "projection apply; a direct write drifts from the event stream and a rebuild drops or resurrects the row.",
  });
}

// Unmanaged tables are the Writable ones; callers invoke this only after executorManagedWriteDenied passed without a capable runner.
export function assertWritableTable<T extends object>(table: T): asserts table is T & Writable {
  if (isExecutorManagedTable(table)) {
    throw new InternalError({
      message: `assertWritableTable: "${tableNameOf(table)}" is executor-managed and the runner holds no write capability.`,
    });
  }
}

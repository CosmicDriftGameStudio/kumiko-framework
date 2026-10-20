import type { DbRunner } from "./db-connection.ts";
import type { EntityTableMeta } from "./entity-table-meta-types.ts";
import type { SchemaTable } from "./schema-table-types.ts";

// Positive brands: a write compiles only for a table carrying `Writable` or a
// runner carrying the executor capability. Symbol keys dodge SchemaTable's
// string index signature; widening a table to plain SchemaTable drops the
// brand, so erasure fails closed instead of open.
declare const WRITABLE: unique symbol;
export interface Writable {
  readonly [WRITABLE]: true;
}
export type WritableTable = EntityTableMeta & Writable;

// Type-level mirror of the runtime capability registered in
// framework/src/db/executor-managed-tables.ts.
declare const EXECUTOR_MANAGED_WRITE: unique symbol;
export interface ExecutorManagedWriteCapability {
  readonly [EXECUTOR_MANAGED_WRITE]: true;
}
export type ExecutorManagedRunner = DbRunner & ExecutorManagedWriteCapability;

// Named so declaration emit prints the alias instead of expanding SchemaTable's symbol keys.
export type WritableSchemaTable = SchemaTable & Writable;

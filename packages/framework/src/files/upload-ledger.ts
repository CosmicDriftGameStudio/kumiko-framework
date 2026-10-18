import type {
  FileProviderResolver,
  FileUploadLedger,
} from "@cosmicdrift/kumiko-types/file-provider-resolver-types";
import type { FileStorageProvider } from "@cosmicdrift/kumiko-types/file-storage-provider-types";
import type { TenantId } from "@cosmicdrift/kumiko-types/identifiers";
import type { DbConnection, DbRunner } from "../db/connection.ts";
import { defineUnmanagedTable, type EntityTableMeta } from "../db/entity-table-meta.ts";
import { createTenantDb, type TenantDb } from "../db/tenant-db.ts";
import { tenantDbRunner } from "../db/tenant-db-runner.ts";

const CREATED_AT_INDEX = "store_file_upload_ledger_created_at_idx";

// One row per upload whose bytes are in storage but whose fileRef row is not committed yet. The
// commit path deletes it inside the transaction that creates the fileRef; the sweep finds the
// rows that never got there. Unmanaged: a coordination aid, not state with an event history.
export const fileUploadLedgerTable: EntityTableMeta = defineUnmanagedTable({
  tableName: "store_file_upload_ledger",
  indexes: [{ name: CREATED_AT_INDEX, columns: ["created_at"] }],
  columns: [
    { name: "storage_key", pgType: "text", notNull: true, primaryKey: true },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "created_at", pgType: "timestamptz", notNull: true },
  ],
});

function isTenantDb(db: DbConnection | TenantDb): db is TenantDb {
  return "tenantId" in db && "fetchOne" in db && typeof db.fetchOne === "function";
}

// The ledger writes on a connection of its own, never on a handler transaction: a rollback of the
// handler must not take the row with it, or the bytes it uploaded would be unfindable.
export function createFileUploadLedger(
  db: DbConnection | TenantDb,
  tenantId: TenantId,
): FileUploadLedger {
  const runner: DbRunner = isTenantDb(db) ? tenantDbRunner(db) : db;
  const ledgerDb = createTenantDb({ db: runner, tenantId });
  return {
    record: async (storageKey) => {
      await ledgerDb.insertOne(fileUploadLedgerTable, {
        storageKey,
        tenantId,
        createdAt: Temporal.Now.instant(),
      });
    },
    forget: async (storageKey) => {
      await ledgerDb.deleteMany(fileUploadLedgerTable, { storageKey });
    },
  };
}

export function withUploadLedger(
  resolver: (tenantId: TenantId) => Promise<FileStorageProvider>,
  db: DbConnection | TenantDb,
): FileProviderResolver {
  return Object.assign(resolver, {
    uploadLedgerFor: (tenantId: TenantId) => createFileUploadLedger(db, tenantId),
  });
}

// Runs inside the transaction that creates the fileRef row. False means no ledger row was left to
// take: the sweep already removed the bytes, so the row must not be committed.
export async function takeUploadLedgerEntry(txDb: TenantDb, storageKey: string): Promise<boolean> {
  return (await txDb.deleteMany(fileUploadLedgerTable, { storageKey })) > 0;
}

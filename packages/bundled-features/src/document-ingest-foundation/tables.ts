import {
  defineUnmanagedTable,
  instant,
  integer,
  table as pgTable,
  sql,
  text,
  uniqueIndex,
  uuid,
} from "@cosmicdrift/kumiko-framework/db";

const INGEST_PROGRESS_FILE_REF_UNIQUE = "store_document_ingest_progress_tenant_file_ref_unique";

// One row per ingested file, written directly by reportIngestProgress (no events).
export const documentIngestProgressTable = pgTable(
  "store_document_ingest_progress",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    fileRefId: text("file_ref_id").notNull(),
    pagesDone: integer("pages_done").notNull(),
    pagesTotal: integer("pages_total").notNull(),
    updatedAt: instant("updated_at").default(sql`now()`).notNull(),
  },
  (t) => [uniqueIndex(INGEST_PROGRESS_FILE_REF_UNIQUE).on(t.tenantId, t.fileRefId)],
);

// Unmanaged: a display-only progress row needs no version or audit columns. The unique index
// is the conflict target of the upsert in reportIngestProgress.
export const documentIngestProgressTableMeta = defineUnmanagedTable({
  tableName: "store_document_ingest_progress",
  indexes: [
    { name: INGEST_PROGRESS_FILE_REF_UNIQUE, columns: ["tenant_id", "file_ref_id"], unique: true },
  ],
  columns: [
    { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "file_ref_id", pgType: "text", notNull: true },
    { name: "pages_done", pgType: "integer", notNull: true },
    { name: "pages_total", pgType: "integer", notNull: true },
    { name: "updated_at", pgType: "timestamptz", notNull: true, defaultSql: "now()" },
  ],
});

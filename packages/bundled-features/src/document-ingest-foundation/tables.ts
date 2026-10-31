import {
  defineUnmanagedTable,
  type EntityTableMeta,
  index,
  instant,
  integer,
  table as pgTable,
  sql,
  text,
  uuid,
} from "@cosmicdrift/kumiko-framework/db";

const INGEST_PROGRESS_FILE_REF_INDEX = "store_document_ingest_progress_tenant_id_file_ref_id_idx";

// One row per ingest stream (PK = documentIngestAggregateId), upserted by the
// "ingest-progress" projection on every documentIngest.progress event.
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
  (t) => [index(INGEST_PROGRESS_FILE_REF_INDEX).on(t.tenantId, t.fileRefId)],
);

// Unmanaged: the id is the event-stream aggregate id and replays are idempotent via the PK upsert,
// so the managed base columns (version, audit columns) have no use here.
export const documentIngestProgressTableMeta: EntityTableMeta = defineUnmanagedTable({
  tableName: "store_document_ingest_progress",
  indexes: [{ name: INGEST_PROGRESS_FILE_REF_INDEX, columns: ["tenant_id", "file_ref_id"] }],
  columns: [
    { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "file_ref_id", pgType: "text", notNull: true },
    { name: "pages_done", pgType: "integer", notNull: true },
    { name: "pages_total", pgType: "integer", notNull: true },
    { name: "updated_at", pgType: "timestamptz", notNull: true, defaultSql: "now()" },
  ],
});

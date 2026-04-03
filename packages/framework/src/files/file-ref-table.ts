import { integer, table as pgTable, serial, text, timestamp } from "../db/dialect";

export const fileRefsTable = pgTable("file_refs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  storageKey: text("storage_key").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  fieldName: text("field_name"),
  insertedAt: timestamp("inserted_at").defaultNow().notNull(),
  insertedById: integer("inserted_by_id"),
});

export const FILE_REFS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS file_refs (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    storage_key TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    field_name TEXT,
    inserted_at TIMESTAMP DEFAULT NOW() NOT NULL,
    inserted_by_id INTEGER
  )
`;

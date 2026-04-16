import { integer, table as pgTable, serial, text, timestamp, uuid } from "../db/dialect";

export const fileRefsTable = pgTable("file_refs", {
  id: serial("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  storageKey: text("storage_key").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  entityType: text("entity_type"),
  // entityId references any entity (mostly UUID-keyed under ES). Text keeps
  // the column backward-compat with older integer-keyed entities too.
  entityId: text("entity_id"),
  fieldName: text("field_name"),
  insertedAt: timestamp("inserted_at").defaultNow().notNull(),
  insertedById: text("inserted_by_id"),
});

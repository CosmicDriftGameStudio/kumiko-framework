import { sql } from "drizzle-orm";
import { instant, integer, table as pgTable, text, uuid } from "../db/dialect";

// `id` is a UUID (not serial): it doubles as the aggregate-id for the
// `fileRef` event stream — every upload appends exactly one
// `files:event:uploaded` event keyed by this id. UUIDs also close the
// enumeration-attack vector on /files/:id URLs.
export const fileRefsTable = pgTable("file_refs", {
  id: uuid("id").primaryKey(),
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
  insertedAt: instant("inserted_at").default(sql`now()`).notNull(),
  insertedById: text("inserted_by_id"),
});

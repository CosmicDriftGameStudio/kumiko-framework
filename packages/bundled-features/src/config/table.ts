import { instant, table as pgTable, serial, text, uniqueIndex, uuid } from "@kumiko/framework/db";
import { sql } from "drizzle-orm";

export const configValuesTable = pgTable(
  "config_values",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    value: text("value"),
    tenantId: uuid("tenant_id"),
    // User-IDs are UUID-strings post-ES migration (SessionUser.id: string).
    userId: text("user_id"),
    insertedAt: instant("inserted_at").default(sql`now()`).notNull(),
    modifiedAt: instant("modified_at"),
    modifiedById: text("modified_by_id"),
  },
  (table) => [uniqueIndex("config_values_unique").on(table.key, table.tenantId, table.userId)],
);

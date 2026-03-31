import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const configValuesTable = pgTable(
  "config_values",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    value: text("value"),
    tenantId: integer("tenant_id"),
    userId: integer("user_id"),
    insertedAt: timestamp("inserted_at").defaultNow().notNull(),
    modifiedAt: timestamp("modified_at"),
    modifiedById: integer("modified_by_id"),
  },
  (table) => [uniqueIndex("config_values_unique").on(table.key, table.tenantId, table.userId)],
);

export const CONFIG_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS config_values (
    id SERIAL PRIMARY KEY,
    key TEXT NOT NULL,
    value TEXT,
    tenant_id INTEGER,
    user_id INTEGER,
    inserted_at TIMESTAMP DEFAULT NOW() NOT NULL,
    modified_at TIMESTAMP,
    modified_by_id INTEGER,
    UNIQUE(key, tenant_id, user_id)
  )
`;

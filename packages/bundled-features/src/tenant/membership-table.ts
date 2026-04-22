import { instant, table as pgTable, serial, text, uniqueIndex, uuid } from "@kumiko/framework/db";
import { sql } from "drizzle-orm";

export const tenantMembershipsTable = pgTable(
  "tenant_memberships",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    roles: text("roles").notNull(), // JSON array: ["Admin", "Billing"]
    insertedAt: instant("inserted_at").default(sql`now()`).notNull(),
    modifiedAt: instant("modified_at"),
  },
  (table) => [uniqueIndex("tenant_memberships_unique").on(table.userId, table.tenantId)],
);

import {
  boolean,
  instant,
  table as pgTable,
  serial,
  text,
  uniqueIndex,
  uuid,
} from "@kumiko/framework/db";
import { sql } from "drizzle-orm";

export const deliveryLogTable = pgTable("delivery_logs", {
  id: serial("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  notificationType: text("notification_type").notNull(),
  channel: text("channel").notNull(),
  // User-IDs as UUID-strings post-ES migration.
  recipientId: text("recipient_id"),
  recipientAddress: text("recipient_address"),
  status: text("status").notNull().$type<"sent" | "failed" | "skipped">(),
  error: text("error"),
  createdAt: instant("created_at").default(sql`now()`).notNull(),
});

export const notificationPreferencesTable = pgTable(
  "notification_preferences",
  {
    id: serial("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    userId: text("user_id").notNull(),
    notificationType: text("notification_type").notNull(), // qualified name or "*" for all
    channel: text("channel").notNull(), // "inApp", "email", "push", or "*"
    enabled: boolean("enabled").default(true).notNull(),
    updatedAt: instant("updated_at").default(sql`now()`).notNull(),
  },
  (table) => [
    uniqueIndex("notification_pref_unique").on(
      table.tenantId,
      table.userId,
      table.notificationType,
      table.channel,
    ),
  ],
);

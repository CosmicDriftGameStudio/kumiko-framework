import { boolean, instant, table as pgTable, serial, text, uuid } from "@cosmicdrift/kumiko-framework/db";
import { sql } from "drizzle-orm";

export const inAppMessagesTable = pgTable("in_app_messages", {
  id: serial("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  userId: text("user_id").notNull(),
  notificationType: text("notification_type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  data: text("data"), // JSON string for action, screen, etc.
  isRead: boolean("is_read").default(false).notNull(),
  readAt: instant("read_at"),
  createdAt: instant("created_at").default(sql`now()`).notNull(),
});

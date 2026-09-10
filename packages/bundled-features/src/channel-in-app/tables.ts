import { asEntityTableMeta } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  boolean,
  type EntityTableMeta,
  instant,
  table as pgTable,
  serial,
  sql,
  text,
  uuid,
} from "@cosmicdrift/kumiko-framework/db";

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

// Derived from inAppMessagesTable (table() attaches the meta as a Symbol) so
// the two can't drift, instead of hand-duplicating the column list.
const derivedInAppMessagesTableMeta = asEntityTableMeta(inAppMessagesTable);
if (!derivedInAppMessagesTableMeta) {
  throw new Error("inAppMessagesTable: table carries no EntityTableMeta — built via table()?");
}
export const inAppMessagesTableMeta: EntityTableMeta = derivedInAppMessagesTableMeta;

import { requireEntityTableMeta } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  boolean,
  type EntityTableMeta,
  index,
  instant,
  table as pgTable,
  serial,
  sql,
  text,
  uuid,
} from "@cosmicdrift/kumiko-framework/db";

export const inAppMessagesTable = pgTable(
  "in_app_messages",
  {
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
  },
  // Every inbox, unread-count, mark-all-read and userData export/delete read filters by tenant + user.
  (t) => [index("in_app_messages_tenant_user_created_idx").on(t.tenantId, t.userId, t.createdAt)],
);

// Derived from inAppMessagesTable (table() attaches the meta as a Symbol) so
// the two can't drift, instead of hand-duplicating the column list.
export const inAppMessagesTableMeta: EntityTableMeta = requireEntityTableMeta(
  inAppMessagesTable,
  "inAppMessagesTable",
);

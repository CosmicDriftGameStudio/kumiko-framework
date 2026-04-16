import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  table as pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from "../db/dialect";
import type { SerializedTraceContext } from "../observability";

// Framework-internal table for the Transactional Outbox pattern.
//
// INSERT happens inside the business transaction via ctx.emit — so either the
// business write + the event row both commit, or neither does. A separate
// poller then publishes unpublished rows to Redis / in-process subscribers
// at-least-once.
//
// The partial index on (createdAt) WHERE publishedAt IS NULL AND deadLetter
// = false is what makes the poller's "next batch" query fast even when the
// table has millions of long-ago published rows. Added via raw SQL since
// drizzle-orm doesn't model partial indexes cleanly across dialects yet.
export const eventOutboxTable = pgTable("event_outbox", {
  id: serial("id").primaryKey(),
  tenantId: uuid("tenant_id"), // nullable — system-scope events have no tenant
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  // Observability: captured W3C-ish trace context at emit time. The poller
  // reconstructs it to start the outbox.publish span as a child of the
  // emitting request's trace. Nullable — emits outside an active span (e.g.
  // direct DB seed scripts) simply don't carry parent context.
  traceContext: jsonb("trace_context").$type<SerializedTraceContext>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  publishedAt: timestamp("published_at"),
  attempts: integer("attempts").default(0).notNull(),
  lastError: text("last_error"),
  deadLetter: boolean("dead_letter").default(false).notNull(),
});

export const EVENT_OUTBOX_PARTIAL_INDEX_SQL = sql`
  CREATE INDEX IF NOT EXISTS event_outbox_unpublished_idx
  ON event_outbox (created_at)
  WHERE published_at IS NULL AND dead_letter = false
`;

// Wake-up channel the poller subscribes to. After a successful commit of an
// emit'ed event, the dispatcher fires a fire-and-forget redis.publish on this
// channel so the poller wakes up quickly — the 50ms polling fallback is only
// for when Redis is unavailable.
export const OUTBOX_WAKE_CHANNEL = "outbox:woken";

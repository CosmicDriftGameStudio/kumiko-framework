// Dead-letter storage for failed event upcasters.
//
// Background: upcastStoredEvent walks a stored event's payload through
// r.eventMigration transforms until it matches the current schema. A
// migration that throws (malformed legacy payload, DB-dependent
// enrichment that fails) propagates to the dispatcher and kills the
// pass — one bad event in a million can stall every projection behind
// it. The same applies to MSP rebuild.
//
// Quarantine mode captures the failure into `kumiko_upcaster_dead_letters`,
// lets the dispatcher skip the event, and surfaces the row count via
// ops tooling. Replay (re-apply the migration after a code fix) is a
// separate CLI step — not implemented here, tracked as follow-up.

import type { DbConnection, DbRunner } from "../db/connection";
import {
  bigint,
  index,
  integer,
  jsonb,
  table as pgTable,
  text,
  timestamp,
  uuid,
} from "../db/dialect";
import { tableExists } from "../db/schema-inspection";
import { unsafePushTables } from "../stack";
import type { StoredEvent } from "./event-store";

export const upcasterDeadLetterTable = pgTable(
  "kumiko_upcaster_dead_letters",
  {
    // Surrogate PK. We don't reuse eventId so a single event can land
    // here multiple times (retry attempts across deploys before the fix
    // lands) without unique-violation noise.
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    // StoredEvent.id is surfaced as `string` (bigint serialised for JSON
    // safety). Storing as text keeps the round-trip identity without a
    // coerce step at every write site.
    eventId: text("event_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    eventType: text("event_type").notNull(),
    fromVersion: integer("from_version").notNull(),
    targetVersion: integer("target_version").notNull(),
    errorMessage: text("error_message").notNull(),
    originalPayload: jsonb("original_payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventTypeIdx: index("upcaster_dead_letters_event_type_idx").on(t.eventType),
    createdAtIdx: index("upcaster_dead_letters_created_at_idx").on(t.createdAt),
  }),
);

// Idempotent table-create. Called from setupTestStack for suites that
// exercise the quarantine path; production boot uses drizzle-kit push.
export async function createUpcasterDeadLetterTable(db: DbConnection): Promise<void> {
  // skip: table already exists — bootstrap called from multiple paths
  if (await tableExists(db, "public.kumiko_upcaster_dead_letters")) return;
  await unsafePushTables(db, { kumikoUpcasterDeadLetters: upcasterDeadLetterTable });
}

// Writes a dead-letter row. Called by upcastStoredEvent when errorPolicy
// is "quarantine" and a transform threw. Returns the inserted row id —
// ops tooling uses it for correlate-and-replay flows.
export async function recordUpcasterDeadLetter(
  db: DbRunner,
  args: {
    event: StoredEvent;
    fromVersion: number;
    targetVersion: number;
    error: unknown;
  },
): Promise<void> {
  const message = args.error instanceof Error ? args.error.message : String(args.error);
  const { insertOne } = await import("../bun-db/query");
  await insertOne(db, upcasterDeadLetterTable, {
    eventId: args.event.id,
    tenantId: args.event.tenantId,
    aggregateId: args.event.aggregateId,
    aggregateType: args.event.aggregateType,
    eventType: args.event.type,
    fromVersion: args.fromVersion,
    targetVersion: args.targetVersion,
    errorMessage: message,
    originalPayload: args.event.payload,
  });
}

export type DeadLetterRow = {
  readonly id: bigint;
  readonly eventId: string;
  readonly tenantId: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly eventType: string;
  readonly fromVersion: number;
  readonly targetVersion: number;
  readonly errorMessage: string;
  readonly originalPayload: Record<string, unknown>;
  readonly createdAt: Date;
};

// Ops-side query. Loads recent failures, optionally scoped by event-type
// to triage a single broken migration without pulling the full table.
export async function listDeadLetters(
  db: DbConnection,
  options: { eventType?: string; limit?: number } = {},
): Promise<readonly DeadLetterRow[]> {
  const { selectMany } = await import("../bun-db/query");
  const limit = options.limit ?? 100;
  const where = options.eventType !== undefined ? { eventType: options.eventType } : undefined;
  const rows = await selectMany<DeadLetterRow>(db, upcasterDeadLetterTable, where, {
    orderBy: { col: "createdAt", direction: "desc" },
    limit,
  });
  return rows;
}

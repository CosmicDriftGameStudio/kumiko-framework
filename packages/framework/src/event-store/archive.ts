import { and, eq, sql } from "drizzle-orm";
import type { DbConnection, DbRunner } from "../db/connection";
import { instant, table as pgTable, text, uniqueIndex, uuid } from "../db/dialect";
import { tableExists } from "../db/schema-inspection";
import type { TenantId } from "../engine/types";
import { unsafePushTables } from "../stack";
import { deleteMany } from "@cosmicdrift/kumiko-framework/db";

// Marten-aligned stream archival. Archived streams become read-only: fresh
// appendEvent on an archived aggregate throws, and loadAggregate returns
// an empty slice unless the caller passes { includeArchived: true }.
//
// Storage: sparse table — only ARCHIVED streams have a row. Active streams
// stay out of this table to keep the hot path free of extra writes. A
// tenant-scoped PK guards against cross-tenant reuse of aggregate IDs.

export const archivedStreamsTable = pgTable(
  "kumiko_archived_streams",
  {
    tenantId: uuid("tenant_id").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    archivedAt: instant("archived_at", { precision: 3 }).notNull().default(sql`now()`),
    archivedBy: text("archived_by").notNull(),
    reason: text("reason"),
  },
  (t) => ({
    pk: uniqueIndex("kumiko_archived_streams_pk").on(t.tenantId, t.aggregateId),
  }),
);

export async function createArchivedStreamsTable(db: DbConnection): Promise<void> {
  // skip: table already exists — idempotent boot + test-setup call
  if (await tableExists(db, "public.kumiko_archived_streams")) return;
  await unsafePushTables(db, { kumikoArchivedStreams: archivedStreamsTable });
}

export type ArchiveStreamArgs = {
  readonly tenantId: TenantId;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly archivedBy: string;
  readonly reason?: string;
};

// Mark a stream as archived. Idempotent — re-archiving (same tenant +
// aggregate) updates archivedAt/archivedBy to the latest call instead of
// failing. That matches Marten's "archive is a state, not an event" model.
export async function archiveStream(db: DbRunner, args: ArchiveStreamArgs): Promise<void> {
  await db
    .insert(archivedStreamsTable)
    .values({
      tenantId: args.tenantId,
      aggregateId: args.aggregateId,
      aggregateType: args.aggregateType,
      archivedBy: args.archivedBy,
      reason: args.reason ?? null,
    })
    .onConflictDoUpdate({
      target: [archivedStreamsTable.tenantId, archivedStreamsTable.aggregateId],
      set: {
        archivedAt: sql`now()`,
        archivedBy: args.archivedBy,
        aggregateType: args.aggregateType,
        reason: args.reason ?? null,
      },
    });
}

// Cheap existence probe — issued in the hot read path, so keep the query to
// a single indexed lookup on the composite PK.
export async function isStreamArchived(
  db: DbRunner,
  tenantId: TenantId,
  aggregateId: string,
): Promise<boolean> {
  const rows = await db
    .select({ one: sql`1` })
    .from(archivedStreamsTable)
    .where(
      and(
        eq(archivedStreamsTable.tenantId, tenantId),
        eq(archivedStreamsTable.aggregateId, aggregateId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// Undo an archive — restores the stream to writable state. Ops tool. The
// historical archivedAt is lost; if auditing needs the archive-history,
// use domain events on the aggregate (e.g. "stream.archived" / "stream.
// restored") instead of relying on this row.
export async function restoreStream(
  db: DbRunner,
  tenantId: TenantId,
  aggregateId: string,
): Promise<void> {
  await deleteMany(db, archivedStreamsTable, { tenantId, aggregateId });
}

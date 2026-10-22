// Inbound-mail data retention. DSGVO Art. 5 (data minimization):
// without retention, read_inbound_messages and the file-storage bodies grow
// without bound. Two targets, two mechanisms—the difference is
// event-sourced versus unmanaged:
//
//   read_inbound_messages (event-sourced, EXPLICIT r.projection):
//     each Row older than messageRetentionDays → archiveStream + Row delete
//     (+ delete the bodyRef object). archiveStream instead of executor.forget
//     because the projection maps only the received domain event, not the
//     forgotten auto-verb (which only ImplicitProjection registers). A
//     forget event would be ignored during a rebuild, causing the Row to be
//     resurrected from the received event. The archived stream makes
//     loadAggregate empty, so received is not replicated in the first place.
//     Same pattern as tenant-destroy-hook, but with a per-Row cutoff instead
//     of an entire Tenant.
//
//   store_mail_seen_messages (unmanaged, direct-write, not event-sourced):
//     The deduplication anchor is needed only for the backfill/replay window →
//     seenAt cutoff via plain deleteMany, with no stream/archive. Scoped
//     directly through the table's tenant_id column (table-builder convention),
//     without an Account join.
//
// LIMITATION: the PII in the message events remains decryptable under the
// TENANT subject key—per-Row retention does not shred a key. Actual Art.-17
// erasure of event payloads happens only during tenant-destroy (key erasure).
// The read Row and body file are gone after the sweep; the event log is
// append-only by design.

import { type DbRunner, deleteMany, selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  archiveStream,
  deleteRowsWithoutReplayableStream,
} from "@cosmicdrift/kumiko-framework/event-store";
import type { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { seenMessageTable } from "./entities.ts";
import { INBOUND_MESSAGE_AGGREGATE_TYPE } from "./events.ts";
import { inboundMessagesProjectionTable } from "./projection.ts";

// Provides Temporal.Instant without forcing the caller to obtain it from
// globalThis (same pattern as data-retention/keep-for.ts).
type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

export const MESSAGE_RETENTION_DAYS = 365;
export const SEEN_RETENTION_DAYS = 90;
const BATCH_LIMIT = 1000;
const ARCHIVED_BY = "inbound-mail:retention";
const REASON = "retention_expired";

export interface InboundRetentionArgs {
  readonly db: DbRunner;
  readonly tenantId: TenantId;
  /**
   * Injects the current time so tests can pin it without a date mock (pattern from keep-for.ts).
   */
  readonly now: Instant;
  readonly messageRetentionDays?: number;
  readonly seenRetentionDays?: number;
  /** Deletes a file-storage body object by bodyRef key. Wired lazily by the job
   * (createFileProviderForTenant); if absent, no body is deleted. */
  readonly deleteBodyObject?: (bodyRef: string) => Promise<void>;
}

export interface InboundRetentionReport {
  readonly messagesPurged: number;
  readonly bodyObjectsDeleted: number;
  readonly bodyObjectErrors: number;
  readonly seenPurged: number;
}

export async function runInboundMailRetention(
  args: InboundRetentionArgs,
): Promise<InboundRetentionReport> {
  const messageDays = args.messageRetentionDays ?? MESSAGE_RETENTION_DAYS;
  const seenDays = args.seenRetentionDays ?? SEEN_RETENTION_DAYS;
  const messageCutoff = args.now.subtract({ hours: messageDays * 24 });
  const seenCutoff = args.now.subtract({ hours: seenDays * 24 });

  const messages = await purgeExpiredMessages(args, messageCutoff);
  const seenPurged = await purgeExpiredSeenAnchors(args.db, args.tenantId, seenCutoff);

  return { ...messages, seenPurged };
}

type ExpiredMessageRow = { readonly id: string; readonly bodyRef: string | null };

async function purgeExpiredMessages(
  args: InboundRetentionArgs,
  cutoff: Instant,
): Promise<Omit<InboundRetentionReport, "seenPurged">> {
  let messagesPurged = 0;
  let bodyObjectsDeleted = 0;
  let bodyObjectErrors = 0;

  // Drain loop: each page deletes the Rows it reads, so the next page is fresh.
  // Run archiveStream BEFORE deletion: if a crash occurs in between, the next
  // run re-archives idempotently and deletes the Row. Delete strictly by the
  // archived IDs, never with a cutoff WHERE; otherwise an old mail arriving
  // between select and delete could be deleted without being archived and
  // resurrected during a rebuild.
  //
  // A Row whose deleteBodyObject fails is NOT deleted; otherwise the only
  // reference to the now-orphaned file object would be lost (no retry or
  // dead-letter). The Row remains for the next sweep (archiveStream is
  // idempotent). failedIds prevents such a Row from being selected endlessly
  // during THIS run.
  const failedIds = new Set<string>();
  for (;;) {
    const rows = (
      await selectMany<ExpiredMessageRow>(
        args.db,
        inboundMessagesProjectionTable,
        { receivedAt: { lt: cutoff }, tenantId: args.tenantId },
        { limit: BATCH_LIMIT },
      )
    ).filter((row) => !failedIds.has(row.id));
    if (rows.length === 0) break;

    const ids: string[] = [];
    for (const row of rows) {
      await archiveStream(args.db, {
        tenantId: args.tenantId,
        aggregateId: row.id,
        aggregateType: INBOUND_MESSAGE_AGGREGATE_TYPE,
        archivedBy: ARCHIVED_BY,
        reason: REASON,
      });
      if (row.bodyRef && args.deleteBodyObject) {
        try {
          await args.deleteBodyObject(row.bodyRef);
          bodyObjectsDeleted++;
        } catch {
          bodyObjectErrors++;
          failedIds.add(row.id);
          continue;
        }
      }
      ids.push(row.id);
    }
    if (ids.length > 0) {
      const deleted = await deleteRowsWithoutReplayableStream(args.db, {
        table: inboundMessagesProjectionTable,
        ids,
        tenantId: args.tenantId,
      });
      messagesPurged += deleted.length;
    }

    if (rows.length < BATCH_LIMIT) break;
  }

  return { messagesPurged, bodyObjectsDeleted, bodyObjectErrors };
}

async function purgeExpiredSeenAnchors(
  db: DbRunner,
  tenantId: TenantId,
  cutoff: Instant,
): Promise<number> {
  // Seen anchors inherit tenantId (table-builder: every Entity has tenant_id) →
  // scoped directly to the tenant, without an Account join. This also includes
  // anchors whose Account has already been disconnected or deleted.
  const where = { tenantId, seenAt: { lt: cutoff } };
  const expired = await selectMany<{ accountId: string }>(db, seenMessageTable, where);
  if (expired.length === 0) return 0;
  await deleteMany(db, seenMessageTable, where);
  return expired.length;
}

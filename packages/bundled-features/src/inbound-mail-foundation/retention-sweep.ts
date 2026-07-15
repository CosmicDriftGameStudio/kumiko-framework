// Inbound-mail data-retention (#957). DSGVO Art. 5 (Datenminimierung):
// ohne Retention wachsen read_inbound_messages + die File-Storage-Bodies
// unbegrenzt. Zwei Targets, zwei Mechanismen — der Unterschied ist
// event-sourced vs. unmanaged:
//
//   read_inbound_messages (event-sourced, EXPLIZITE r.projection):
//     pro Row aelter als messageRetentionDays → archiveStream + Row-Delete
//     (+ bodyRef-Objekt loeschen). archiveStream statt executor.forget, weil
//     die Projection nur das received-Domain-Event mappt, nicht den
//     forgotten-Auto-Verb (den registriert nur ImplicitProjection). Ein
//     forget-Event wuerde beim Rebuild ignoriert und die Row aus dem
//     received-Event resurrecten (#648-Klasse). Der archivierte Stream macht
//     loadAggregate leer → received wird gar nicht erst repliziert. Gleiches
//     Muster wie tenant-destroy-hook, nur per-Row-cutoff statt ganzer Tenant.
//
//   read_mail_seen_messages (unmanaged, direct-write, nicht event-sourced):
//     Dedup-Anker braucht nur das Backfill-/Replay-Fenster → seenAt-cutoff
//     via plain deleteMany, kein Stream/Archiv. Gescoped direkt über die
//     tenant_id-Spalte der Tabelle (table-builder-Konvention), kein Account-Join.
//
// GRENZE (#957 Teil 2, Plan §3.4): die PII in den Message-Events bleibt
// unter dem TENANT-Subject-Key entschluesselbar — per-Row-Retention
// shreddet keinen Key. Echte Art.-17-Erasure der Event-Payloads passiert
// erst bei tenant-destroy (Key-Erase). Read-Row + Body-File sind nach dem
// Sweep weg; das Event-Log ist append-only by design.

import {
  type DbRunner,
  deleteMany,
  type EntityTableMeta,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { archiveStream } from "@cosmicdrift/kumiko-framework/event-store";
import type { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { seenMessageTable } from "./entities";
import { INBOUND_MESSAGE_AGGREGATE_TYPE } from "./events";
import { inboundMessagesProjectionTable } from "./projection";

// Temporal.Instant ohne den Caller zwingen es aus globalThis zu ziehen
// (Muster data-retention/keep-for.ts).
type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

export const MESSAGE_RETENTION_DAYS = 365;
export const SEEN_RETENTION_DAYS = 90;
const BATCH_LIMIT = 1000;
const ARCHIVED_BY = "inbound-mail:retention";
const REASON = "retention_expired";

export interface InboundRetentionArgs {
  readonly db: DbRunner;
  readonly tenantId: TenantId;
  /** Now-Injection — Tests pinnen den Wert ohne Date-Mock (Pattern keep-for.ts). */
  readonly now: Instant;
  readonly messageRetentionDays?: number;
  readonly seenRetentionDays?: number;
  /** Loescht ein file-storage-Body-Objekt per bodyRef-key. Vom Job lazy
   *  verdrahtet (createFileProviderForTenant). Fehlt = kein Body-Delete. */
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

  // Drain-Loop: jede Page loescht die Rows die sie liest, die naechste ist
  // damit frisch. archiveStream VOR dem Delete (crash dazwischen → naechster
  // Lauf re-archiviert idempotent + loescht). Delete strikt nach den
  // archivierten ids, nie per cutoff-WHERE — sonst koennte eine zwischen
  // select und delete eingegangene Alt-Mail unarchiviert geloescht werden
  // und beim Rebuild resurrecten.
  for (;;) {
    const rows = await selectMany<ExpiredMessageRow>(
      args.db,
      inboundMessagesProjectionTable,
      { receivedAt: { lt: cutoff }, tenantId: args.tenantId },
      { limit: BATCH_LIMIT },
    );
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
        }
      }
      ids.push(row.id);
    }
    await deleteMany(args.db, inboundMessagesProjectionTable as EntityTableMeta, {
      id: { in: ids },
    });
    messagesPurged += ids.length;

    if (rows.length < BATCH_LIMIT) break;
  }

  return { messagesPurged, bodyObjectsDeleted, bodyObjectErrors };
}

async function purgeExpiredSeenAnchors(
  db: DbRunner,
  tenantId: TenantId,
  cutoff: Instant,
): Promise<number> {
  // Seen-Anker erben tenantId (table-builder: jede Entity hat tenant_id) →
  // direkt tenant-scoped, kein Account-Join. Trifft auch Anker, deren Account
  // schon disconnected/geloescht ist.
  const where = { tenantId, seenAt: { lt: cutoff } };
  const expired = await selectMany<{ accountId: string }>(
    db,
    seenMessageTable as EntityTableMeta,
    where,
  );
  if (expired.length === 0) return 0;
  await deleteMany(db, seenMessageTable as EntityTableMeta, where);
  return expired.length;
}

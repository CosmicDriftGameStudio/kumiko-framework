// Audit-Helper fuer Download-Endpoint (S2.U3 Atom 4b).
//
// Beim Download (Token-Pfad oder Job-Pfad) werden Audit-Felder am
// Token-Row aktualisiert:
//   - useCount + 1
//   - lastUsedAt = now
//   - lastUsedFromIp = caller-IP (X-Forwarded-For oder Connection-IP)
//   - lastUsedUserAgent = UA-Header
//
// **Best-Effort-Update:** version-conflicts (zwei parallel-Downloads
// raceen um den update) werden silent geswallowt — Audit ist "letzter
// Use", nicht "alle Uses". Der zweite Download succeeded trotzdem
// (kein download-block bei race).
//
// **ES via tokenCrud.update:** kein direct-UPDATE. Memory
// `feedback_no_fake_dispatcher` + `feedback_event_store_tenant_consistency`.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { tokenCrud } from "./run-export-jobs";
import { downloadAttemptEntity, downloadAttemptsTable } from "./schema/download-attempt";

const attemptCrud = createEventStoreExecutor(downloadAttemptsTable, downloadAttemptEntity, {
  entityName: "download-attempt",
});

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

export interface RecordDownloadUseArgs {
  readonly db: DbConnection;
  readonly tokenId: string;
  readonly tokenVersion: number;
  readonly tokenUseCount: number;
  /**
   * Tenant fuer die system-mode-TenantDb. ExportDownloadToken ist
   * tenant-agnostisch (1:1 zum tenant-agnostic Job), aber der event-
   * store-Stream-Lookup braucht einen Tenant-Context. Wir nutzen
   * job.requestedFromTenantId — dieselbe Identitaet wie beim
   * Token-Create im Worker (Atom 4a).
   */
  readonly tenantId: TenantId;
  readonly now: Instant;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/**
 * Audit-Update: useCount, lastUsedAt, IP, UA. Best-effort —
 * version-conflicts (parallel-downloads) werden swallowed, Download
 * succeeded trotzdem.
 */
export async function recordDownloadUse(args: RecordDownloadUseArgs): Promise<void> {
  const { db, tokenId, tokenVersion, tokenUseCount, tenantId, now, ip, userAgent } = args;
  const executor = createSystemUser(tenantId);
  const tdb = createTenantDb(db, tenantId, "system");

  await tokenCrud
    .update(
      {
        id: tokenId,
        version: tokenVersion,
        changes: {
          useCount: tokenUseCount + 1,
          lastUsedAt: now,
          lastUsedFromIp: ip,
          lastUsedUserAgent: userAgent,
        },
      },
      executor,
      tdb,
    )
    .catch(() => {
      // version-conflict bei parallelen Downloads → der erste hat
      // bereits useCount inkrementiert. Wir behalten den Audit-Eintrag
      // des ersten Downloads (lastUsedAt etc.). Kein download-block.
    });
}

// extractCallerIp lebt in feature.ts (extractAuditMeta) — query-handler
// haben keinen direkten Header-Zugriff (transport-agnostic), httpRoute-
// Wrapper extrahiert + steckt in payload.auditMeta.

export type DownloadAttemptResult = "notFound" | "expired" | "failed" | "signedUrlNotSupported";

export interface RecordInvalidAttemptArgs {
  readonly db: DbConnection;
  readonly tenantId: TenantId;
  readonly now: Instant;
  readonly result: DownloadAttemptResult;
  readonly via: "token" | "job";
  readonly tokenHash: string | null;
  readonly jobId: string | null;
  readonly attemptedByUserId: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

// Best-effort INSERT in read_download_attempts. Throws im Audit-Pfad
// duerfen den Download-Endpoint nicht killen (User soll seinen 404
// bekommen, nicht 500); failures werden silent geswallowt.
export async function recordInvalidAttempt(args: RecordInvalidAttemptArgs): Promise<void> {
  const { db, tenantId, now } = args;
  const executor = createSystemUser(tenantId);
  const tdb = createTenantDb(db, tenantId, "system");
  await attemptCrud
    .create(
      {
        result: args.result,
        via: args.via,
        tokenHash: args.tokenHash,
        jobId: args.jobId,
        attemptedByUserId: args.attemptedByUserId,
        ip: args.ip,
        userAgent: args.userAgent,
        attemptedAt: now,
      },
      executor,
      tdb,
    )
    .catch(() => {
      // best-effort
    });
}

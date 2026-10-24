// Audit helper for the download endpoint.
//
// During a download (token path or job path), audit fields on the token row
// are updated:
//   - useCount + 1
//   - lastUsedAt = now
//   - lastUsedFromIp = caller IP (X-Forwarded-For or connection IP)
//   - lastUsedUserAgent = UA header
//
// **Best-effort update:** version conflicts (two downloads racing to update)
// are silently swallowed — the audit records the "last use", not "all uses".
// The second download still succeeds (a race does not block the download).
//
// **ES via tokenCrud.update:** no direct UPDATE, so the event-store and tenant
// consistency rules remain in effect.

import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { tokenCrud } from "./run-export-jobs.ts";
import { downloadAttemptEntity, downloadAttemptsTable } from "./schema/download-attempt.ts";

const attemptCrud = createEventStoreExecutor(downloadAttemptsTable, downloadAttemptEntity, {
  entityName: "download-attempt",
});

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

export interface RecordDownloadUseArgs {
  readonly db: DbRunner;
  readonly tokenId: string;
  readonly tokenVersion: number;
  readonly tokenUseCount: number;
  /**
   * Tenant for the system-mode TenantDb. ExportDownloadToken is
   * tenant-agnostic (1:1 with the tenant-agnostic job), but the event-store
   * stream lookup requires a tenant context. We use
   * job.requestedFromTenantId — the same identity used when creating the
   * token in the worker.
   */
  readonly tenantId: TenantId;
  readonly now: Instant;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/**
 * Audit update: useCount, lastUsedAt, IP, and UA. Best-effort —
 * version conflicts (parallel downloads) are swallowed, so the download
 * still succeeds.
 */
export async function recordDownloadUse(args: RecordDownloadUseArgs): Promise<void> {
  const { db, tokenId, tokenVersion, tokenUseCount, tenantId, now, ip, userAgent } = args;
  const executor = createSystemUser(tenantId);
  const tdb = createTenantDb({
    db,
    tenantId,
    mode: "system",
    reason: "download audit writes into the token's tenant, outside a request scope",
  });

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
      // A version conflict means a parallel download already incremented
      // useCount. Keep the first download's audit entry (lastUsedAt, etc.);
      // do not block the download.
    });
}

// extractCallerIp lives in feature.ts (extractAuditMeta) — query handlers
// have no direct header access because they are transport-agnostic. The
// httpRoute wrapper extracts it and places it in payload.auditMeta.

export type DownloadAttemptResult = "notFound" | "expired" | "failed" | "signedUrlNotSupported";

export interface RecordInvalidAttemptArgs {
  readonly db: DbRunner;
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

// Best-effort INSERT into read_download_attempts. Errors in the audit path
// must not kill the download endpoint: the user should receive their 404,
// not a 500; failures are silently swallowed.
export async function recordInvalidAttempt(args: RecordInvalidAttemptArgs): Promise<void> {
  const { db, tenantId, now } = args;
  const executor = createSystemUser(tenantId);
  const tdb = createTenantDb({
    db,
    tenantId,
    mode: "system",
    reason: "download audit writes into the token's tenant, outside a request scope",
  });
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

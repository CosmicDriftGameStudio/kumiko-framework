import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";

export type ExportJobCleanupCandidate = {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly requestedFromTenantId: TenantId;
  readonly downloadStorageKey: string | null;
  readonly expiresAt: Temporal.Instant | null;
};

export async function selectExportJobsForStorageCleanup(
  db: DbConnection,
  doneStatus: string,
  failedStatus: string,
): Promise<readonly ExportJobCleanupCandidate[]> {
  return asRawClient(db).unsafe<ExportJobCleanupCandidate>(
    `SELECT id, version, status, requested_from_tenant_id AS "requestedFromTenantId", download_storage_key AS "downloadStorageKey", expires_at AS "expiresAt" FROM read_export_jobs WHERE status IN ($1, $2) AND download_storage_key IS NOT NULL`,
    [doneStatus, failedStatus],
  );
}

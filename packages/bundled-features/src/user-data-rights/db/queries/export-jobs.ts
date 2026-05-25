import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { exportJobsTable } from "../../schema/export-job";

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
  return selectMany<ExportJobCleanupCandidate>(db, exportJobsTable, {
    status: { in: [doneStatus, failedStatus] },
    downloadStorageKey: { ne: null },
  });
}

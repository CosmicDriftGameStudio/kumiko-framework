import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { updateRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import { exportDownloadTokenEntity, exportDownloadTokensTable } from "../schema/download-token.ts";
import { exportJobEntity, exportJobsTable } from "../schema/export-job.ts";

// Export-job and token streams live on the tenant the job was requested from.
export function changeExportJob(
  db: DbConnection,
  jobId: string,
  changes: Readonly<Record<string, unknown>>,
  requestedFromTenantId: TenantId,
): Promise<void> {
  return updateRowViaEventStore(
    db,
    { table: exportJobsTable, entity: exportJobEntity, entityName: "export-job" },
    { id: jobId },
    changes,
    { tenantId: requestedFromTenantId },
  );
}

export function changeExportTokenOfJob(
  db: DbConnection,
  jobId: string,
  changes: Readonly<Record<string, unknown>>,
  requestedFromTenantId: TenantId,
): Promise<void> {
  return updateRowViaEventStore(
    db,
    {
      table: exportDownloadTokensTable,
      entity: exportDownloadTokenEntity,
      entityName: "export-download-token",
    },
    { jobId },
    changes,
    { tenantId: requestedFromTenantId },
  );
}

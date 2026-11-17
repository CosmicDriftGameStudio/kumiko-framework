import type { DbConnection, DbRunner } from "@cosmicdrift/kumiko-framework/db";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { type ExportJobStatus, exportJobsTable } from "../../schema/export-job.ts";

export type ExportJobCleanupCandidate = {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly userId: string;
  readonly requestedFromTenantId: TenantId;
  readonly downloadStorageKey: string | null;
  readonly expiresAt: Temporal.Instant | null;
  readonly completedAt: Temporal.Instant | null;
  readonly startedAt: Temporal.Instant | null;
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

export type ExportBundleRef = {
  readonly id: string;
  readonly version: number;
  readonly requestedFromTenantId: TenantId;
  readonly downloadStorageKey: string;
};

export type ExportJobOfUser = {
  readonly id: string;
  readonly version: number;
  readonly status: ExportJobStatus;
  readonly requestedFromTenantId: TenantId;
  readonly downloadStorageKey: string | null;
};

// One read for every status: a job that turns done between two reads would slip past the forget run.
export async function selectExportJobsOfUser(
  db: DbRunner,
  userId: string,
): Promise<readonly ExportJobOfUser[]> {
  return selectMany<ExportJobOfUser>(db, exportJobsTable, { userId });
}

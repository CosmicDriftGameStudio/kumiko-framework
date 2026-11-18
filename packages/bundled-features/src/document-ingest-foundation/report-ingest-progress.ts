import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { documentIngestProgressPayloadSchema } from "./events.ts";
import { documentIngestProgressTableMeta } from "./tables.ts";

export type ReportIngestProgressInput = {
  readonly fileRefId: string;
  readonly pagesDone: number;
  readonly pagesTotal: number;
};

// Progress is display-only, so it is a direct-write store row instead of an event per batch.
// The upsert only makes sure the row exists (its conflict branch touches updatedAt alone);
// the guarded update then moves pagesDone forward and never back, also when reports for one
// file land out of order or in parallel. The id is random on purpose: a second key derived
// from tenant and file would collide on the primary key before the conflict target applies.
export async function reportIngestProgress(
  db: TenantDb,
  input: ReportIngestProgressInput,
): Promise<void> {
  const progress = documentIngestProgressPayloadSchema.parse(input);
  const updatedAt = Temporal.Now.instant().toString();
  await db.upsert(
    documentIngestProgressTableMeta,
    {
      id: crypto.randomUUID(),
      fileRefId: progress.fileRefId,
      pagesDone: progress.pagesDone,
      pagesTotal: progress.pagesTotal,
      updatedAt,
    },
    { conflictTarget: ["tenantId", "fileRefId"], update: { updatedAt } },
  );
  await db.updateMany(
    documentIngestProgressTableMeta,
    { pagesDone: progress.pagesDone, pagesTotal: progress.pagesTotal, updatedAt },
    { fileRefId: progress.fileRefId, pagesDone: { lte: progress.pagesDone } },
  );
}

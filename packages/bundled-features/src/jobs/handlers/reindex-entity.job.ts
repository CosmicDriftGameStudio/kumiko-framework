// Manual, perTenant backfill job (#1206/#1215) — indexes existing rows for
// an entity that only got `searchable: true` after rows already existed.
// perTenant fan-out (job-runner.ts) also applies to a manual dispatch, not
// just cron: one `jobs:write:trigger` call with { entity } re-runs once per
// active tenant.

import type { JobHandlerFn } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { reindexEntity } from "@cosmicdrift/kumiko-framework/search";
import { z } from "zod";

export const reindexEntityPayloadSchema = z.object({
  entity: z.string().min(1),
});

export const reindexEntityJob: JobHandlerFn = async (rawPayload, ctx): Promise<void> => {
  const { entity } = reindexEntityPayloadSchema.parse(rawPayload);
  if (!ctx.registry) {
    throw new InternalError({
      message: "[jobs:reindex-entity] ctx.registry missing — job context requires the registry.",
    });
  }
  if (!ctx.searchAdapter) {
    throw new InternalError({
      message:
        "[jobs:reindex-entity] ctx.searchAdapter missing — mount a search adapter to run this job.",
    });
  }
  // perTenant fan-out — the job-runner enqueues one child run per active
  // tenant with ctx.systemUser scoped to it; a run without one (e.g.
  // misconfigured manual dispatch outside the fan-out) has nothing scoped
  // to reindex. ctx._tenantId is never populated per-dispatch (only
  // ctx.systemUser is), so it is not a valid fallback here.
  const tenantId = ctx.systemUser?.tenantId;
  if (tenantId === undefined) {
    // skip: fired without a perTenant fan-out tenant — nothing scoped to reindex
    return;
  }
  if (!ctx.systemDb) {
    throw new InternalError({
      message:
        "[jobs:reindex-entity] ctx.systemDb missing — the owning feature must declare r.systemScope().",
    });
  }
  // .raw bypasses tenant filtering, safe here only because reindexEntity
  // filters `WHERE tenant_id = $1` itself with this same tenantId.
  const db = ctx.systemDb.assertTenantMatch(tenantId).raw;
  const result = await reindexEntity(db, ctx.registry, ctx.searchAdapter, entity, tenantId);
  ctx.log?.info?.(
    `[jobs:reindex-entity] tenant=${tenantId} reindexed ${entity}: ${result.indexedRows}/${result.scannedRows} rows indexed` +
      `${result.failures.length > 0 ? ` (${result.failures.length} failed)` : ""}`,
  );
};

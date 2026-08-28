// Backfill/GC job for derivatives orphaned by a forget/tenant-destroy that ran
// before #2461 wired binary cleanup into those flows (#2474). Those older runs
// left the FileRef row gone with no audit trail of what was ever forgotten —
// so this sweep works forward from the deterministic derivative-key grammar
// alone: for every key under a tenant's storage prefix that parses as a
// derivative (parseDerivativeKey), delete it only if NO fileRef row (live or
// trashed) backs its reconstructed original. A row backing the original — even
// a soft-deleted one sitting in trash — means the derivative is still
// legitimate; only genuinely unreferenced derivatives are swept.
//
// Manual trigger only (no cron) — an operator runs this once after upgrading
// past #2461, or on demand for spot-checks.
//
// Row unit for runChunkedMigration is a discovered derivative CANDIDATE KEY,
// not a tenant: one tenant's storage listing produces a variable number of
// candidates, which doesn't fit "one row -> one migrate outcome" if the row
// were a tenant. nextBatch pages tenants internally and buffers their
// candidates into a flat queue so the shared deadline/circuit-breaker/signal
// handling still applies per-key.

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { parseDerivativeKey } from "@cosmicdrift/kumiko-framework/derivatives";
import type { JobHandlerFn, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import {
  assertSafeStorageKey,
  type FileProviderResolver,
  type FileStorageProvider,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import { z } from "zod";
import { runChunkedMigration } from "../../shared";
import { tenantTable } from "../../tenant";

const DEFAULT_TENANT_PAGE_SIZE = 50;
const DEFAULT_CANDIDATE_BATCH_SIZE = 100;
const DEFAULT_MAX_FAILURES = 10;

export const sweepOrphanedDerivativesPayloadSchema = z.object({
  dryRun: z.boolean().optional(),
  batchSize: z.number().int().positive().optional(),
  maxDurationMs: z.number().int().positive().optional(),
  maxFailures: z.number().int().positive().optional(),
});

type DerivativeCandidate = {
  readonly tenantId: TenantId;
  readonly key: string;
  readonly originalKey: string;
  readonly provider: FileStorageProvider;
};

export const sweepOrphanedDerivativesJob: JobHandlerFn = async (rawPayload, ctx): Promise<void> => {
  const payload = sweepOrphanedDerivativesPayloadSchema.parse(rawPayload ?? {});
  if (!ctx.db) {
    throw new InternalError({
      message:
        "[files-tenant-data:sweep] ctx.db missing — job context requires a database connection.",
    });
  }
  const db = ctx.db;
  // Re-bound to a definitely-assigned const: TS control-flow narrowing from
  // the guard above doesn't cross into fillQueue's nested closure below.
  const maybeResolver = ctx._fileProviderResolver;
  if (!maybeResolver) {
    ctx.log?.warn?.(
      "[files-tenant-data:sweep] no _fileProviderResolver wired — nothing to sweep, skipping run",
    );
    return;
  }
  const resolver: FileProviderResolver = maybeResolver;

  const batchSize = payload.batchSize ?? DEFAULT_CANDIDATE_BATCH_SIZE;
  const maxFailures = payload.maxFailures ?? DEFAULT_MAX_FAILURES;
  const deadline = payload.maxDurationMs
    ? Date.now() + payload.maxDurationMs
    : Number.POSITIVE_INFINITY;
  const dryRun = payload.dryRun ?? false;

  let queue: DerivativeCandidate[] = [];
  let tenantCursor: string | undefined;
  let tenantsExhausted = false;
  let dryRunWouldDelete = 0;

  async function fillQueue(): Promise<void> {
    while (queue.length === 0 && !tenantsExhausted) {
      const tenants = await selectMany<{ id: string }>(
        db,
        tenantTable,
        tenantCursor ? { id: { gt: tenantCursor } } : {},
        { orderBy: [{ col: "id", direction: "asc" }], limit: DEFAULT_TENANT_PAGE_SIZE },
      );
      if (tenants.length === 0) {
        tenantsExhausted = true;
        break;
      }
      tenantCursor = tenants.at(-1)?.id;
      for (const tenant of tenants) {
        const tenantId = tenant.id as TenantId;
        let provider: FileStorageProvider;
        try {
          provider = await resolver(tenantId);
        } catch (err) {
          ctx.log?.warn?.(
            `[files-tenant-data:sweep] no file provider resolvable for tenant=${tenantId}, skipping: ${err instanceof Error ? err.message : String(err)}`,
          );
          continue;
        }
        let keys: readonly string[];
        try {
          keys = await provider.list(`${tenantId}/`);
        } catch (err) {
          ctx.log?.warn?.(
            `[files-tenant-data:sweep] provider.list() failed for tenant=${tenantId}, skipping: ${err instanceof Error ? err.message : String(err)}`,
          );
          continue;
        }
        for (const key of keys) {
          const parsed = parseDerivativeKey(key);
          if (!parsed) continue;
          queue.push({ tenantId, key, originalKey: parsed.originalKey, provider });
        }
      }
    }
  }

  async function nextBatch(): Promise<readonly DerivativeCandidate[]> {
    await fillQueue();
    const batch = queue.slice(0, batchSize);
    queue = queue.slice(batch.length);
    return batch;
  }

  async function migrateRow(
    candidate: DerivativeCandidate,
  ): Promise<"migrated" | "skipped" | "failed"> {
    // No isDeleted filter: a soft-deleted (trashed, not yet forgotten) fileRef
    // still legitimately backs its derivatives — only an ABSENT row (forgotten,
    // or a tenant destroyed before #2461 with no row left at all) makes a
    // derivative orphaned.
    const owners = await selectMany(
      db,
      fileRefsTable,
      { tenantId: candidate.tenantId, storageKey: candidate.originalKey },
      { limit: 1 },
    );
    if (owners.length > 0) return "skipped";
    if (dryRun) {
      dryRunWouldDelete++;
      return "skipped";
    }
    assertSafeStorageKey(candidate.key);
    await candidate.provider.delete(candidate.key);
    return "migrated";
  }

  const outcome = await runChunkedMigration<DerivativeCandidate>({
    nextBatch,
    migrateRow,
    maxFailures,
    deadlineAt: deadline,
    signal: ctx.signal,
    onRowError: (candidate, err) => {
      ctx.log?.warn?.(
        `[files-tenant-data:sweep] failed to delete key=${candidate.key} tenant=${candidate.tenantId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    },
  });

  ctx.log?.info?.(
    `[files-tenant-data:sweep] complete dryRun=${dryRun} deleted=${outcome.migrated} wouldDelete=${dryRunWouldDelete} skipped=${outcome.skipped} failed=${outcome.failed} batches=${outcome.batchesProcessed} stoppedReason=${outcome.stoppedReason}`,
  );
};

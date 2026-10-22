import type { Logger } from "@cosmicdrift/kumiko-framework/logging";
// Async export-job worker — a pure pipeline function.
//
// A cron-triggered pass (see the r.job wrap in feature.ts) processes all
// pending jobs. Each job is claimed with optimistic locking through the version
// column: when two worker replicas pick the same job, the second one gets a
// VersionConflictError and skips it. The export bundle is built by
// run-user-export.ts, which also owns the cross-tenant iteration over the
// user's memberships. The requesting tenant's compliance profile supplies
// exportDownloadTtl for expiresAt, and the storage provider is resolved per
// tenant (S3 or local). The ZIP is streamed into storage atomically (tmp+rename
// locally, multipart upload on S3), so a throw anywhere in the pipeline marks
// the job failed without leaving a half-written ZIP at the final path.
//
// Before pickup, a stale pass fails running jobs whose
// startedAt + exportStaleTimeoutMinutes lies in the past, so worker crashes,
// OOM kills and replica restarts do not leave jobs stuck in running.
//
// A final cleanup pass deletes downloadStorageKeys past
// expiresAt + exportStorageCleanupGraceHours, so expired ZIPs do not stay in
// storage indefinitely.

import { addDurationSpec } from "@cosmicdrift/kumiko-framework/compliance";
import { PII_ERASED_SENTINEL } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection, DbRunner } from "@cosmicdrift/kumiko-framework/db";
import {
  createEventStoreExecutor,
  createTenantDb,
  fetchOne,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import type {
  EscapeHatchAuditSink,
  Registry,
  TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  createZipStream,
  type FileStorageProvider,
  tenantExportPrefix,
  type ZipEntry,
} from "@cosmicdrift/kumiko-framework/files";
import type { MetricsHandle } from "@cosmicdrift/kumiko-framework/observability";
import type { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { resolveProfileForTenant } from "../compliance-profiles/index.ts";
import { decryptStoredPii } from "../shared/index.ts";
import { userTable } from "../user/index.ts";
import { selectExportJobsForStorageCleanup } from "./db/queries/export-jobs.ts";
import { runUserExport, type UserExportBundle } from "./run-user-export.ts";
import { exportDownloadTokenEntity, exportDownloadTokensTable } from "./schema/download-token.ts";
import { EXPORT_JOB_STATUS, exportJobEntity, exportJobsTable } from "./schema/export-job.ts";
import { generateDownloadToken } from "./token-helpers.ts";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

// Gauge short name (feature.ts registers it via r.metric + resolves ctx.meter
// into a MetricsHandle — jobs get no bound ctx.metrics, see feature.ts).
// No "_seconds"/"_total" suffix: validateMetricName rejects both on a gauge.
// Unit lives in the r.metric() `unit: "seconds"` declaration instead.
export const EXPORT_CLEANUP_BACKLOG_AGE_METRIC = "export_cleanup_backlog_age";

// Unix seconds of the last storage-cleanup pass that ran to completion. A
// gauge keeps its last value in-process (no TTL), so a dead cron does not make
// the backlog gauge disappear — alert on `time() - this > interval + buffer`.
export const EXPORT_CLEANUP_LAST_RUN_TIMESTAMP_METRIC = "export_cleanup_last_run_timestamp";

const crud = createEventStoreExecutor(exportJobsTable, exportJobEntity, {
  entityName: "export-job",
});

// Separate event-store executor for download tokens. `crud.create` emits
// `exportDownloadToken.created` and synchronously updates
// `read_export_download_tokens`; direct inserts would bypass that projection.
//
// Exported because the download handler uses tokenCrud.update for audit fields
// while preserving event-store consistency.
export const tokenCrud = createEventStoreExecutor(
  exportDownloadTokensTable,
  exportDownloadTokenEntity,
  { entityName: "export-download-token" },
);

/**
 * Notification callback for the done path. The plain token remains ephemeral
 * and is never stored in the database or event store. The application wires
 * this callback to its email provider, such as `delivery.notify`,
 * `mailFoundation.send`, or a custom Resend/SES integration.
 *
 * **Best-effort:** a throw from the callback bubbles to the r.job wrap, and the
 * jobs feature records the worker run as failed in jobRunsTable while the export
 * job stays done. That failed path is covered by Scenario 2 in
 * `jobs/__tests__/jobs-feature.integration.test.ts` instead of being duplicated
 * end to end here. Operators see the failure in the /jobs dashboard and can
 * re-run the worker via jobs:write:retry.
 *
 * **Recovering the plain token after an email failure:** the plain token is
 * ephemeral, so it is lost when the callback throws. Flip the job back to
 * pending and nothing else: do not delete the token row, because an eventless
 * read-side delete collides with projection rebuilds. The next worker run
 * rotates the token in place on the same aggregate.
 */
export type SendExportReadyEmailFn = (args: {
  readonly userId: string;
  readonly userEmail: string;
  /** Stored user.locale (free-form, e.g. "de"/"en"/"de-DE"/null) — lets the
   *  default mailer render in the recipient's language. */
  readonly userLocale: string | null;
  readonly tenantId: TenantId;
  readonly jobId: string;
  readonly downloadUrl: string;
  readonly expiresAt: string;
  readonly bytesWritten: number | null;
}) => Promise<void>;

export type SendExportFailedEmailFn = (args: {
  readonly userId: string;
  readonly userEmail: string;
  readonly userLocale: string | null;
  readonly tenantId: TenantId;
  readonly jobId: string;
  readonly errorMessage: string;
}) => Promise<void>;

export interface RunExportJobsArgs {
  readonly db: DbConnection;
  readonly registry: Registry;
  /**
   * Builds a storage provider for a tenant. The application supplies the
   * `createFileProviderForTenant` resolver so the worker does not depend on
   * HandlerContext.
   */
  readonly buildStorageProvider: (tenantId: TenantId) => Promise<FileStorageProvider>;
  /** Injected time lets tests avoid mocking the system clock. */
  readonly now: Instant;

  /**
   * Optional notification on the done transition. When absent, callers can
   * poll `export-status.query` and let the user trigger the download.
   */
  readonly sendExportReadyEmail?: SendExportReadyEmailFn;
  /** Optional notification on the failed transition. */
  readonly sendExportFailedEmail?: SendExportFailedEmailFn;
  /**
   * Base URL for the magic link, for example
   * "https://app.example.com/user-export/by-token". The worker appends the
   * token as a URL fragment rather than a query parameter. Required when
   * `sendExportReadyEmail` is provided.
   */
  readonly appExportDownloadUrl?: string;

  // Sourced from the owning job's ctx (_escapeHatchAuditSink,
  // systemUser.id); threaded into runUserExport's per-hook TenantDb.
  readonly escapeHatchAuditSink?: EscapeHatchAuditSink;
  readonly escapeHatchAuditLog?: Logger;
  readonly actor?: string;

  /**
   * Reports EXPORT_CLEANUP_BACKLOG_AGE_METRIC after the storage-cleanup
   * pass. Optional so callers without an observability provider still work.
   */
  readonly metrics?: MetricsHandle;
}

export interface ExportJobError {
  readonly jobId: string;
  readonly userId: string;
  readonly phase: "claim" | "bundle" | "zip-write" | "complete";
  readonly message: string;
}

export interface RunExportJobsResult {
  /** IDs of jobs transitioned from pending to done in this pass. */
  readonly completedJobIds: readonly string[];
  /** IDs of jobs transitioned from pending to failed in this pass. */
  readonly failedJobIds: readonly string[];
  /** IDs of stuck running jobs transitioned to failed by stale detection. */
  readonly staleFailedJobIds: readonly string[];
  /** IDs of jobs whose downloadStorageKey was deleted during cleanup. */
  readonly cleanedJobIds: readonly string[];
  readonly errors: readonly ExportJobError[];
  /**
   * Plain tokens for jobs completed in this pass, keyed by job ID. These
   * values are passed to the notification hook only in memory and are never
   * persisted; after the run, the download endpoint can verify only the
   * corresponding database hash.
   */
  readonly tokenByJobId: ReadonlyMap<string, string>;
}

export async function runExportJobs(args: RunExportJobsArgs): Promise<RunExportJobsResult> {
  const { db, registry, buildStorageProvider, now, sendExportReadyEmail, sendExportFailedEmail } =
    args;

  // Validate this configuration before the pass loop so a missing URL is not
  // swallowed by the per-job try/catch. Callback failures are best-effort, but
  // this is a hard application configuration error.
  if (sendExportReadyEmail && args.appExportDownloadUrl === undefined) {
    throw new Error(
      "user-data-rights: sendExportReadyEmail gesetzt aber appExportDownloadUrl fehlt — beide muessen zusammen konfiguriert sein",
    );
  }

  // Fail running jobs whose tenant-specific stale timeout has elapsed before
  // pickup, so a new run recovers jobs left behind by an earlier crash.
  const staleFailedJobIds = await staleDetectionPass({ db, now });

  // Pass 2: Pickup pending jobs + Process them.
  const completedJobIds: string[] = [];
  const failedJobIds: string[] = [];
  const errors: ExportJobError[] = [];
  const tokenByJobId = new Map<string, string>();

  const pendingJobs = await fetchPendingJobs(db);
  for (const job of pendingJobs) {
    const outcome = await processJob({
      db,
      registry,
      buildStorageProvider,
      now,
      job,
      escapeHatchAuditSink: args.escapeHatchAuditSink,
      escapeHatchAuditLog: args.escapeHatchAuditLog,
      actor: args.actor,
    });
    if (outcome.kind === "done") {
      completedJobIds.push(job.id);
      // Keep the plain token only in memory for downstream callbacks; never put it
      // in logs, telemetry, or jobRunsTable.
      tokenByJobId.set(job.id, outcome.tokenPlain);

      // A notification failure must not abort the batch: the job is already done,
      // and retrying the worker would find no pending job and silently miss the
      // notification. `console.warn` is the only available operator visibility
      // because these arguments do not carry AppContext.log.
      if (sendExportReadyEmail) {
        try {
          await fireExportReadyCallback({
            db,
            job,
            plainToken: outcome.tokenPlain,
            bytesWritten: outcome.bytesWritten,
            expiresAt: outcome.expiresAt,
            appExportDownloadUrl: args.appExportDownloadUrl,
            send: sendExportReadyEmail,
          });
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: operator-visibility for email-send-failure
          console.warn(
            `[user-data-rights:run-export-jobs] sendExportReadyEmail failed jobId=${job.id} userId=${job.userId} err=${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } else if (outcome.kind === "failed") {
      failedJobIds.push(job.id);
      errors.push(outcome.error);

      // A failed-job notification is best-effort so an email-send failure cannot
      // abort processing of the remaining pending jobs.
      if (sendExportFailedEmail) {
        try {
          await fireExportFailedCallback({
            db,
            job,
            errorMessage: outcome.error.message,
            send: sendExportFailedEmail,
          });
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: operator-visibility for email-send-failure
          console.warn(
            `[user-data-rights:run-export-jobs] sendExportFailedEmail failed jobId=${job.id} userId=${job.userId} err=${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    // A claim race means another worker already owns the job; skip it without
    // reporting an error.
  }

  // Storage cleanup: expired done jobs (expiresAt + grace < now) get their
  // storage object deleted and downloadStorageKey cleared in the database.
  const cleanedJobIds = await storageCleanupPass({
    db,
    buildStorageProvider,
    now,
    metrics: args.metrics,
  });

  return {
    completedJobIds,
    failedJobIds,
    staleFailedJobIds,
    cleanedJobIds,
    errors,
    tokenByJobId,
  };
}

interface JobRow {
  readonly id: string;
  readonly version: number;
  readonly userId: string;
  readonly requestedFromTenantId: TenantId;
}

// @wrapper-known semantic-alias
async function fetchPendingJobs(db: DbRunner): Promise<readonly JobRow[]> {
  return selectMany<JobRow>(
    db,
    exportJobsTable,
    { status: EXPORT_JOB_STATUS.Pending },
    {
      orderBy: { col: "requestedAt", direction: "asc" },
    },
  );
}

type ProcessOutcome =
  | {
      kind: "done";
      tokenPlain: string;
      expiresAt: Instant;
      bytesWritten: number;
    }
  | { kind: "failed"; error: ExportJobError }
  | { kind: "skipped" }; // claim-race-loss (anderer Worker)

async function processJob(args: {
  db: DbConnection;
  registry: Registry;
  buildStorageProvider: (tenantId: TenantId) => Promise<FileStorageProvider>;
  now: Instant;
  job: JobRow;
  escapeHatchAuditSink?: EscapeHatchAuditSink;
  escapeHatchAuditLog?: Logger;
  actor?: string;
}): Promise<ProcessOutcome> {
  const { db, registry, buildStorageProvider, now, job } = args;
  const executor = createSystemUser(job.requestedFromTenantId);
  // The event-store stream lookup requires a TenantDb even though an export job
  // is tenant-agnostic. System mode bypasses the automatic tenant filter while
  // `requestedFromTenantId` preserves the stream identity.
  const tdb = systemTenantDb(db, job.requestedFromTenantId);

  // Claim with a version check so a concurrent worker causes a conflict.
  // Persist downloadStorageKey during the claim: if the worker crashes after
  // writing the ZIP but before marking the job done, cleanup can find the
  // orphaned object instead of leaving it in storage indefinitely.
  const storageKey = buildExportStorageKey(job);
  const claimResult = await crud.update(
    {
      id: job.id,
      version: job.version,
      changes: {
        status: EXPORT_JOB_STATUS.Running,
        startedAt: now,
        downloadStorageKey: storageKey,
      },
    },
    executor,
    tdb,
  );
  if (!claimResult.isSuccess) {
    // Another worker won the claim race, so skip this job without logging an error.
    return { kind: "skipped" };
  }

  // Build the bundle, stream the ZIP, and write it to storage. Errors before
  // completion are materialized as a failed job.
  try {
    const bundle = await runUserExport({
      db,
      registry,
      userId: job.userId,
      now,
      escapeHatchAuditSink: args.escapeHatchAuditSink,
      escapeHatchAuditLog: args.escapeHatchAuditLog,
      actor: args.actor,
    });

    const profile = await resolveProfileForTenant({
      db,
      tenantId: job.requestedFromTenantId,
    });
    const ttl = profile.profile.userRights.exportDownloadTtl;

    // Cross-tenant file references require a provider per tenant because storage
    // configuration may differ. Cache each provider so a tenant is initialized
    // only once; the requested tenant owns the write path, while reads use each
    // file reference's tenantId.
    const providerCache = new Map<TenantId, FileStorageProvider>();
    const cachedProvider = async (tenantId: TenantId): Promise<FileStorageProvider> => {
      let p = providerCache.get(tenantId);
      if (!p) {
        p = await buildStorageProvider(tenantId);
        providerCache.set(tenantId, p);
      }
      return p;
    };

    const writeProvider = await cachedProvider(job.requestedFromTenantId);
    // The provider type requires both methods, so runtime optional checks are
    // unnecessary.

    const tracker = countingStream(
      createZipStream(bundleToZipEntries(bundle, now, cachedProvider)),
    );

    await writeProvider.writeStream(storageKey, tracker.stream, {
      mimeType: "application/zip",
    });

    // Create the token before the done transition: if token creation fails, the
    // job is still running and the catch path marks it failed (monotonic status).
    // A crash between the two calls can orphan a token and a ZIP; the next
    // stale-detection pass fails the job and the cleanup pass removes the ZIP.
    //
    // The plain token stays in worker memory and reaches the notification
    // through RunExportJobsResult; only its hash is stored.
    //
    // **Reruns:** when an operator flips a done or failed job back to pending
    // (lost plain token, email failure), a token row already exists for the
    // jobId. A second create would emit another created event on a fresh
    // aggregate, and projection rebuilds would keep colliding on the
    // one_per_job index. Rotate the token in place on the existing aggregate
    // instead (fresh hash, audit fields reset).
    const expiresAt = addDurationSpec(now, ttl);
    const { plain: tokenPlain, hash: tokenHash } = await generateDownloadToken();
    const existingToken = await fetchOne<{ id: string; version: number }>(
      db,
      exportDownloadTokensTable,
      { jobId: job.id },
    );
    const tokenCreateResult = existingToken
      ? await tokenCrud.update(
          {
            id: existingToken.id,
            version: existingToken.version,
            changes: {
              tokenHash,
              issuedAt: now,
              expiresAt,
              useCount: 0,
              lastUsedAt: null,
              lastUsedFromIp: null,
              lastUsedUserAgent: null,
            },
          },
          executor,
          tdb,
        )
      : await tokenCrud.create(
          {
            jobId: job.id,
            tokenHash,
            issuedAt: now,
            expiresAt,
            // Set useCount explicitly to 0 so verification can increment it with
            // `useCount + 1` without defensive COALESCE logic.
            useCount: 0,
          },
          executor,
          tdb,
        );
    if (!tokenCreateResult.isSuccess) {
      // Token creation failed before the done transition. The catch path marks the
      // job failed, and cleanup can remove the ZIP whose path was persisted at
      // claim time.
      throw new Error(
        `Job ${job.id}: Token-Creation failed before done-flip. ` +
          `${(tokenCreateResult as { error?: { code?: string } }).error?.code ?? "unknown"}`, // @cast-boundary engine-payload
      );
    }

    // Persist the same expiresAt used for the token on the job row as well.
    const doneResult = await crud.update(
      {
        id: job.id,
        version: job.version + 1, // +1 because the claim already performed one update
        changes: {
          status: EXPORT_JOB_STATUS.Done,
          completedAt: now,
          // downloadStorageKey was set during the claim, so it does not need to be
          // written again.
          expiresAt,
          bytesWritten: tracker.bytes,
        },
      },
      executor,
      tdb,
    );
    if (!doneResult.isSuccess) {
      // The done transition failed after claiming. Mark the job failed so the
      // operator can see the error; the token and ZIP remain for later cleanup.
      throw new Error(
        `Job ${job.id}: failed to flip status=done after successful Token-Create. ` +
          `${(doneResult as { error?: { code?: string } }).error?.code ?? "unknown"}`, // @cast-boundary engine-payload
      );
    }

    return { kind: "done", tokenPlain, expiresAt, bytesWritten: tracker.bytes };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Failure handling is best-effort. If the failure transition also fails, the
    // job remains running and stale detection will recover it on a later run.
    await crud
      .update(
        {
          id: job.id,
          version: job.version + 1,
          changes: {
            status: EXPORT_JOB_STATUS.Failed,
            completedAt: now,
            errorMessage: message,
          },
        },
        executor,
        tdb,
      )
      .catch(() => {
        /* swallow — stale-detection kommt im nachsten Pass */
      });
    return {
      kind: "failed",
      error: {
        jobId: job.id,
        userId: job.userId,
        phase: "zip-write",
        message,
      },
    };
  }
}

async function staleDetectionPass(args: {
  db: DbConnection;
  now: Instant;
}): Promise<readonly string[]> {
  const { db, now } = args;

  // Fetch all running jobs instead of applying a coarse one-hour filter:
  // exportStaleTimeoutMinutes is tenant-specific and may be as low as five
  // minutes, so a coarse filter could miss stale jobs. The expected number of
  // running jobs makes resolving each tenant's profile practical.
  const candidates = await selectMany<{
    id: string;
    version: number;
    userId: string;
    requestedFromTenantId: TenantId;
    startedAt: Instant | null;
  }>(db, exportJobsTable, { status: EXPORT_JOB_STATUS.Running });

  const failed: string[] = [];
  for (const c of candidates) {
    const profile = await resolveProfileForTenant({
      db,
      tenantId: c.requestedFromTenantId,
    });
    const cutoffMs =
      now.epochMilliseconds - profile.profile.userRights.exportStaleTimeoutMinutes * 60 * 1000;
    const startedMs = c.startedAt?.epochMilliseconds ?? Number.MAX_SAFE_INTEGER;
    if (startedMs < cutoffMs) {
      const result = await crud.update(
        {
          id: c.id,
          version: c.version,
          changes: {
            status: EXPORT_JOB_STATUS.Failed,
            completedAt: now,
            errorMessage: "stale: worker crashed mid-run",
          },
        },
        createSystemUser(c.requestedFromTenantId),
        systemTenantDb(db, c.requestedFromTenantId),
      );
      if (result.isSuccess) failed.push(c.id);
      // Another worker completed the job, so skip it.
    }
  }
  return failed;
}

async function storageCleanupPass(args: {
  db: DbConnection;
  buildStorageProvider: (tenantId: TenantId) => Promise<FileStorageProvider>;
  now: Instant;
  metrics?: MetricsHandle;
}): Promise<readonly string[]> {
  const { db, buildStorageProvider, now, metrics } = args;

  // Done jobs are cleaned after expiresAt plus the tenant's grace period
  // (default 24h after expiry, so re-downloads after a dropped connection still
  // work). Failed jobs with a persisted downloadStorageKey are orphaned ZIPs:
  // the worker wrote the ZIP but failed before the done flip, so no token was
  // ever issued and no user has seen it. They are removed immediately, without
  // grace: the right to erasure outweighs forensics here, and the job's
  // errorMessage and stack trace are the operator's audit record. An operator
  // who needs the ZIP itself must capture it out of band before this pass.
  const candidates = await selectExportJobsForStorageCleanup(
    db,
    EXPORT_JOB_STATUS.Done,
    EXPORT_JOB_STATUS.Failed,
  );

  const cleaned: string[] = [];
  // Candidates past their due-instant, keyed by that instant — used below to
  // report how far cleanup has fallen behind if a candidate is still standing
  // (delete threw, or the version-checked null-out lost a race) once the pass
  // is done. Done jobs are due at expiresAt+grace; Failed jobs (orphaned ZIPs,
  // no TTL) are due at completedAt ?? startedAt, i.e. from the first pass.
  const overdueDoneCleanupAfterMs = new Map<string, number>();
  let passCompleted = false;
  try {
    for (const c of candidates) {
      if (!c.downloadStorageKey) continue;

      // Done jobs need the expiresAt+grace check. Failed jobs pass straight
      // through (no user path, so clean up immediately).
      if (c.status === EXPORT_JOB_STATUS.Done) {
        if (!c.expiresAt) continue;
        // Count the candidate as overdue (lower bound, grace unknown) before the
        // throwing profile lookup, so a failing pass still shows a backlog.
        overdueDoneCleanupAfterMs.set(c.id, c.expiresAt.epochMilliseconds);
        const profile = await resolveProfileForTenant({
          db,
          tenantId: c.requestedFromTenantId,
        });
        const cleanupAfter =
          c.expiresAt.epochMilliseconds +
          profile.profile.userRights.exportStorageCleanupGraceHours * 60 * 60 * 1000;
        if (now.epochMilliseconds < cleanupAfter) {
          overdueDoneCleanupAfterMs.delete(c.id);
          continue;
        }
        overdueDoneCleanupAfterMs.set(c.id, cleanupAfter);
      }
      // Failed-job branch: no TTL check, clean up immediately.
      else {
        const failedAt = c.completedAt ?? c.startedAt;
        if (failedAt) overdueDoneCleanupAfterMs.set(c.id, failedAt.epochMilliseconds);
      }

      // Delete the storage file and null the DB column.
      try {
        const provider = await buildStorageProvider(c.requestedFromTenantId);
        await provider.delete(c.downloadStorageKey);
      } catch {
        // best-effort; if the storage delete fails, retry on the next pass
        continue;
      }
      const result = await crud.update(
        {
          id: c.id,
          version: c.version,
          changes: { downloadStorageKey: null },
        },
        createSystemUser(c.requestedFromTenantId),
        systemTenantDb(db, c.requestedFromTenantId),
      );
      if (result.isSuccess) cleaned.push(c.id);
    }
    passCompleted = true;
  } finally {
    reportOldestOverdueAge(metrics, overdueDoneCleanupAfterMs, cleaned, now);
    if (passCompleted) reportCleanupLastRun(metrics, now);
  }

  return cleaned;
}

// Seconds since the longest-overdue bundle (Done: expiresAt+grace passed;
// Failed: completedAt ?? startedAt) should have been deleted but still isn't — 0 when the pass
// cleaned everything that was due, or nothing was due.
function oldestOverdueAgeSeconds(
  overdueDoneCleanupAfterMs: ReadonlyMap<string, number>,
  cleanedIds: readonly string[],
  now: Instant,
): number {
  const cleaned = new Set(cleanedIds);
  let oldestAgeSeconds = 0;
  for (const [id, cleanupAfterMs] of overdueDoneCleanupAfterMs) {
    if (cleaned.has(id)) continue;
    const ageSeconds = (now.epochMilliseconds - cleanupAfterMs) / 1000;
    if (ageSeconds > oldestAgeSeconds) oldestAgeSeconds = ageSeconds;
  }
  return oldestAgeSeconds;
}

// Best-effort like the email callbacks above: an observability hiccup
// (metric not yet registered on this meter, provider misconfig) must not
// fail a pass that otherwise cleaned up fine.
function reportOldestOverdueAge(
  metrics: MetricsHandle | undefined,
  overdueDoneCleanupAfterMs: ReadonlyMap<string, number>,
  cleanedIds: readonly string[],
  now: Instant,
): void {
  // skip: no meter configured means there is nothing to report — the cleanup pass itself already ran to completion.
  if (!metrics) return;
  try {
    metrics.set(
      EXPORT_CLEANUP_BACKLOG_AGE_METRIC,
      oldestOverdueAgeSeconds(overdueDoneCleanupAfterMs, cleanedIds, now),
    );
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: operator-visibility for observability-emit-failure
    console.warn(
      `[user-data-rights:run-export-jobs] metrics.set(${EXPORT_CLEANUP_BACKLOG_AGE_METRIC}) failed err=${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function reportCleanupLastRun(metrics: MetricsHandle | undefined, now: Instant): void {
  // skip: no meter configured means there is nothing to report.
  if (!metrics) return;
  try {
    metrics.set(EXPORT_CLEANUP_LAST_RUN_TIMESTAMP_METRIC, now.epochMilliseconds / 1000);
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: operator-visibility for observability-emit-failure
    console.warn(
      `[user-data-rights:run-export-jobs] metrics.set(${EXPORT_CLEANUP_LAST_RUN_TIMESTAMP_METRIC}) failed err=${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// `crud.update` requires a TenantDb for event-store stream lookup. Export jobs are tenant-agnostic
// (one job per userId), so system mode bypasses the automatic tenant filter while
// `requestedFromTenantId` preserves stream identity and keeps the stream counter consistent.
// @wrapper-known semantic-alias
function systemTenantDb(db: DbConnection, tenantId: TenantId) {
  return createTenantDb({ db, tenantId, mode: "system" });
}

function buildExportStorageKey(job: JobRow): string {
  return `${tenantExportPrefix(job.requestedFromTenantId)}${job.id}.zip`;
}

/**
 * Converts a UserExportBundle to an `AsyncIterable<ZipEntry>` for
 * createZipStream. `bundle.json` contains the bundle metadata and file
 * references; each file is streamed from the provider at its `zipPath`, so
 * large files do not require an in-memory copy.
 *
 * `getProvider` caches providers by tenantId, ensuring each tenant is built
 * only once while processing cross-tenant file references.
 */
async function* bundleToZipEntries(
  bundle: UserExportBundle,
  mtime: Instant,
  getProvider: (tenantId: TenantId) => Promise<FileStorageProvider>,
): AsyncIterable<ZipEntry> {
  // Emit bundle.json first so readers can parse the metadata before the file
  // entries arrive.
  const bundleJson = JSON.stringify(bundle, null, 2);
  yield {
    path: "bundle.json",
    data: oneShot(new TextEncoder().encode(bundleJson)),
    mtime,
  };

  // File binaries: one ZIP entry per fileRef. `data` is the readStream directly,
  // so the ZIP builder consumes chunks without an upfront memory spike. Even
  // with 50 PDFs at 10MB each, at most about 64KB (default highWaterMark) is
  // held in the heap at once.
  for (const ref of bundle.fileRefs) {
    const provider = await getProvider(ref.tenantId);
    // `readStream` is required by the FileStorageProvider type, so no runtime
    // optional check is needed.
    yield {
      path: ref.zipPath,
      data: provider.readStream(ref.storageKey),
      mtime,
    };
  }
}

async function* oneShot(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

/**
 * Wraps an `AsyncIterable<Uint8Array>` and counts the total bytes. After
 * `for await`, `tracker.bytes` contains the final value used for
 * `bytesWritten` in the job row.
 */
function countingStream(source: AsyncIterable<Uint8Array>): {
  stream: AsyncIterable<Uint8Array>;
  readonly bytes: number;
} {
  const tracker = { bytes: 0 };
  const stream: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      for await (const chunk of source) {
        tracker.bytes += chunk.byteLength;
        yield chunk;
      }
    },
  };
  return {
    stream,
    get bytes() {
      return tracker.bytes;
    },
  };
}

// Reads directly from the database because the worker's AppContext has no
// queryAs, unlike HandlerContext in the request path. The cross-tenant
// export iteration uses the same approach; a dispatcher-based cross-feature
// API would require a JobContext wrapper that the framework does not provide.
//
// userTable.id is globally unique. Even when a user belongs to multiple
// tenants, there is only one user row with its home tenant as tenantId, so a
// lookup without a tenantId filter works from any worker tenant context.
async function lookupUserContact(
  db: DbConnection,
  userId: string,
): Promise<{ email: string; locale: string | null } | null> {
  // @cast-boundary db-row.
  const row = (await fetchOne(db, userTable, { id: userId })) as {
    email: string | null;
    locale: string | null;
  } | null;
  if (!row?.email) return null;
  const email = await decryptStoredPii(row.email, "email", "user-data-rights:export-ready");
  if (email === PII_ERASED_SENTINEL) return null;
  return { email, locale: row.locale ?? null };
}

// The callback is best-effort: its failure must not abort the batch because
// the job is already done, and retrying the worker will not find it pending.
// The failure remains visible in the worker-run audit log.
async function fireExportReadyCallback(args: {
  readonly db: DbConnection;
  readonly job: JobRow;
  readonly plainToken: string;
  readonly expiresAt: Instant;
  readonly bytesWritten: number;
  readonly appExportDownloadUrl: string | undefined;
  readonly send: SendExportReadyEmailFn;
}): Promise<void> {
  const contact = await lookupUserContact(args.db, args.job.userId);
  if (!contact) {
    // If the user row is missing, skip the notification instead of throwing:
    // the job remains done, and the token remains available through
    // export-status.query. console.warn is used because the worker arguments
    // do not currently carry AppContext.log.
    // biome-ignore lint/suspicious/noConsole: operator-visibility for missing-user edge-case
    console.warn(
      `[user-data-rights:run-export-jobs] userId=${args.job.userId} hat kein userEmail — sendExportReadyEmail skipped`,
    );
    // skip: missing user-email row; console.warn above provides operator visibility
    return;
  }
  const baseUrl = args.appExportDownloadUrl;
  if (!baseUrl) {
    throw new Error(
      "user-data-rights: sendExportReadyEmail gesetzt aber appExportDownloadUrl fehlt — beide muessen zusammen konfiguriert sein",
    );
  }
  const downloadUrl = `${baseUrl}#token=${encodeURIComponent(args.plainToken)}`;
  await args.send({
    userId: args.job.userId,
    userEmail: contact.email,
    userLocale: contact.locale,
    tenantId: args.job.requestedFromTenantId,
    jobId: args.job.id,
    downloadUrl,
    expiresAt: args.expiresAt.toString(),
    bytesWritten: args.bytesWritten,
  });
}

async function fireExportFailedCallback(args: {
  readonly db: DbConnection;
  readonly job: JobRow;
  readonly errorMessage: string;
  readonly send: SendExportFailedEmailFn;
}): Promise<void> {
  const contact = await lookupUserContact(args.db, args.job.userId);
  if (!contact) {
    // biome-ignore lint/suspicious/noConsole: operator-visibility
    console.warn(
      `[user-data-rights:run-export-jobs] userId=${args.job.userId} hat kein userEmail — sendExportFailedEmail skipped`,
    );
    // skip: missing user-email row; console.warn above provides operator visibility
    return;
  }
  await args.send({
    userId: args.job.userId,
    userEmail: contact.email,
    userLocale: contact.locale,
    tenantId: args.job.requestedFromTenantId,
    jobId: args.job.id,
    errorMessage: args.errorMessage,
  });
}

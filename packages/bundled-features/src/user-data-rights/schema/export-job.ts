import { buildEntityTable, sql } from "@cosmicdrift/kumiko-framework/db";
import {
  createBigIntField,
  createEntity,
  createLongTextField,
  createSelectField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

// Export-job lifecycle.
//
// User triggers `request-export` → ExportJob (status="pending"). The worker
// picks it up → "running" → on success, "done" + downloadStorageKey set
// + expiresAt = completedAt + compliance-profile.userRights.exportDownloadTtl
// (configurable per tenant via override, default 7 days). On throw or stale
// timeout → "failed" with errorMessage. Stale timeout and storage-cleanup
// grace are also read from the compliance profile.
//
// Status values are constants—the single source of truth for the worker,
// application code (`request-export` handler), UI polling banner, and test
// drift guard.
export const EXPORT_JOB_STATUS = {
  Pending: "pending",
  Running: "running",
  Done: "done",
  Failed: "failed",
} as const;

export type ExportJobStatus = (typeof EXPORT_JOB_STATUS)[keyof typeof EXPORT_JOB_STATUS];

/**
 * Database constraint name for the partial UNIQUE index (one active job per
 * user). This is the single source of truth: request-export.write catches
 * 23505 with this name as race protection, and tests pin it as the
 * `expectUniqueViolation` argument. Renaming it propagates automatically.
 */
export const ACTIVE_JOB_CONSTRAINT = "read_export_jobs_one_active_per_user";

const EXPORT_JOB_STATUS_OPTIONS = [
  EXPORT_JOB_STATUS.Pending,
  EXPORT_JOB_STATUS.Running,
  EXPORT_JOB_STATUS.Done,
  EXPORT_JOB_STATUS.Failed,
] as const;

// **Tenant-agnostic** like userTable — one job per userId across all
// memberships; the worker iterates cross-tenant via ctx.db.unsafeRaw (same pattern as runForgetCleanup).
//
// **Idempotency:** Partial UNIQUE index on `(userId)` WHERE
// `status IN ('pending', 'running')`. A user with a pending job cannot start
// a second parallel job—the insert fails with a constraint violation, which
// the request-export handler catches and uses to return the existing pending
// job (insert-or-return). This closes the race window. Done/failed jobs can
// be retained indefinitely per user for audit history.
//
// **idType: "uuid"** — job IDs cross process boundaries (BullMQ payloads,
// job-run logger, and audit events for the DPO). Serial IDs are only reliable
// within one process; UUIDs remain stable across processes.
export const exportJobEntity = createEntity({
  table: "read_export_jobs",
  idType: "uuid",
  description:
    "One user's GDPR Art. 20 data-export request and its lifecycle: who asked, from which tenant, the pending/running/done/failed status, the timestamps, the download storage key and expiry, and any error the export worker hit.",

  fields: {
    // Tenant-agnostic: set when writing because the framework requires a
    // tenant_id column, but ignored at the domain level.
    // No maxLength — follows userTable.id and tenantMembershipsTable.userId
    // (both have no maxLength). The userId shape is platform-wide; here it is
    // only used for storage.
    userId: createTextField({
      required: true,
      searchable: true,
      personal: false,
      reason: "pseudonymous_fk",
    }),

    // **requestedFromTenantId** — the tenant from which the user submitted the
    // request. This persisted audit path tells the worker which compliance
    // profile applies to the job TTL, stale timeout, and cleanup. This keeps
    // one effective profile per request instead of changing with every
    // cross-tenant click. The tenant is taken from the first click (option a).
    // The column is not simply named "tenantId" to avoid confusion with the
    // framework-generated tenant_id column.
    //
    // **Worker note:** Profile resolution must use `requestedFromTenantId`
    // (`queryAs(systemUserOf(requestedFromTenantId),
    // "compliance-profiles:query:for-tenant", {})`), not
    // `executor.tenantId`; otherwise a job picked up from another tenant
    // context would use the wrong profile.
    requestedFromTenantId: createTextField({
      required: true,
      personal: false,
      reason: "technical_reference",
    }),

    status: createSelectField({
      required: true,
      default: EXPORT_JOB_STATUS.Pending,
      options: EXPORT_JOB_STATUS_OPTIONS,
    }),

    // When the user requested the job. Required because no job row exists
    // without a request.
    requestedAt: createTimestampField({
      required: true,
      sortable: true,
    }),

    // When the worker began processing the job. NULL while `pending`.
    // Stale detection uses this together with
    // compliance-profile.userRights.exportStaleTimeoutMinutes.
    startedAt: createTimestampField({}),

    // When the worker completed the job, successfully or with failure. NULL
    // while `running`.
    completedAt: createTimestampField({}),

    // Storage key of the completed ZIP file. NULL until `done`.
    // The worker sets this and writes the ZIP bytes via
    // storage-provider.write(key).
    // This is not a signed URL—the download endpoint generates the signed URL
    // on demand through the storage provider.
    downloadStorageKey: createTextField({
      maxLength: 500,
      personal: false,
      reason: "technical_reference",
    }),

    // When the download is no longer available. The worker sets
    // `completedAt + compliance-profile.userRights.exportDownloadTtl`
    // when switching to `done`. NULL for pending, running, and failed jobs.
    //
    // Storage cleanup requirement: after
    // `expiresAt + compliance-profile.userRights.exportStorageCleanupGraceHours`,
    // a separate pass deletes expired ZIPs so they do not remain on S3.
    expiresAt: createTimestampField({}),

    // Failed-state diagnostics. longText because hook errors with stack
    // traces can run several KB. `reason: "is_business_data"` because
    // job status is publicly visible in UI polling (no PII).
    errorMessage: createLongTextField({
      personal: false,
      reason: "is_business_data",
    }),

    // Audit information for operators: the export size. This supports capacity
    // planning and detects pathological cases (a streaming ZIP containing 5 GB
    // of files writes several billion bytes, so integer overflow would cause
    // silent audit drift).
    //
    // bigInt provides a JS-`number` round trip via mode:"number", safe up to
    // 2^53 ≈ 9 PB and suitable for JSON-based status polling.
    bytesWritten: createBigIntField({}),
  },

  // Partial UNIQUE index: only one active job per user; done/failed history
  // is unlimited. request-export.write uses an application-side pre-check as
  // the primary path and catches this constraint's 23505 as race protection
  // for the <1ms window between fetchOne and crud.create.
  indexes: [
    {
      unique: true,
      columns: ["userId"],
      name: ACTIVE_JOB_CONSTRAINT,
      where: sql`status IN ('pending', 'running')`,
    },
  ],
});

export const exportJobsTable = buildEntityTable("exportJob", exportJobEntity);

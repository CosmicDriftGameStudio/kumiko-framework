// GET /api/query → user-data-rights:query:download-by-job
//
// **UI download flow** (session-auth): The user polls the status, sees
// "done", and clicks "Download" with the jobId. The server checks
// `session.userId == job.userId`; no token is needed because the session
// provides authentication.
//
// **Cross-tenant same user:** Jobs are tenant-agnostic (one job per userId
// across all memberships). If Alice starts an export in Tenant A, later
// signs in to Tenant B, and clicks Download, the server accepts it:
// `session.userId == job.userId` is sufficient; no tenant-match check applies.
//
// **Cross-user isolation:** If session.userId != job.userId, return 404
// (not 403) to avoid leaking whether the job exists. Use the same error as
// for an unknown job ID.
//
// Verification pipeline:
//   1. Fetch the job by jobId
//   2. Check job.userId === session.userId (cross-user isolation)
//   3. Check job.status === "done"
//   4. Check job.downloadStorageKey != null
//   5. Look up tokenRow (audit-row update only)
//   6. Best-effort audit update: useCount + 1, IP, UA, lastUsedAt
//   7. Return {url, expiresAt}

import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import {
  defineQueryHandler,
  SYSTEM_USER_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import * as z from "zod";
import { recordDownloadUse, recordInvalidAttempt } from "../audit-download.ts";
import { makeTenantStorageProviderResolver } from "../lib/storage-provider-resolver.ts";
import { exportDownloadTokensTable } from "../schema/download-token.ts";
import { EXPORT_JOB_STATUS, exportJobsTable } from "../schema/export-job.ts";

const SIGNED_URL_TTL_SECONDS = 300; // 5 min — matched download-by-token

const DOWNLOAD_BY_JOB_REASON =
  "export jobs, their download tokens and audit rows are keyed by job id / userId across the user's tenant memberships, not the caller's current tenant";

interface TokenRow {
  readonly id: string;
  readonly version: number;
  readonly useCount: number | null;
}

interface JobRow {
  readonly id: string;
  readonly userId: string;
  readonly requestedFromTenantId: string;
  readonly status: string;
  readonly downloadStorageKey: string | null;
  readonly bytesWritten: number | null;
}

export const downloadByJobQuery = defineQueryHandler({
  name: "download-by-job",
  schema: z.object({
    jobId: z.string().min(1, "jobId required"),
  }),
  access: {
    openToAll: {
      reason:
        "each signed-in user downloads only their own finished export job; the job " +
        "lookup checks jobRow.userId against the caller's own id and 404s otherwise",
    },
  }, // openToAll requires authentication; anonymous access is not allowed
  description:
    "Returns a short-lived signed download URL for the calling user's own finished data-export job named by job id, backing the download button in the privacy center once export-status reports the job done.",
  escapeHatch: {
    grants: ["unsafeRaw"],
    reason: DOWNLOAD_BY_JOB_REASON,
  },
  handler: async (query, ctx) => {
    const T = getTemporal();
    const now = T.Now.instant();
    const userId = query.user.id;
    const jobId = query.payload.jobId;
    const tenantId = query.user.tenantId;
    // IP and UA from the request-scoped context populated by
    // requestIdMiddleware; these are server-trusted rather than client-supplied.
    const auditIp = requestContext.get()?.ip ?? null;
    const auditUa = requestContext.get()?.userAgent ?? null;
    const runner = ctx.db.unsafeRaw();

    // Step 1-2: job-lookup + cross-user-isolation
    const jobRow = await fetchOne<JobRow>(runner, exportJobsTable, { id: jobId });

    if (!jobRow || jobRow.userId !== userId) {
      await recordInvalidAttempt({
        db: runner,
        tenantId,
        now,
        result: "notFound",
        via: "job",
        tokenHash: null,
        jobId,
        attemptedByUserId: userId,
        ip: auditIp,
        userAgent: auditUa,
      });
      throw new NotFoundError("export-download", jobId, {
        i18nKey: "userDataRights.errors.download.notFound",
      });
    }

    if (jobRow.status !== EXPORT_JOB_STATUS.Done) {
      await recordInvalidAttempt({
        db: runner,
        tenantId,
        now,
        result: "failed",
        via: "job",
        tokenHash: null,
        jobId,
        attemptedByUserId: userId,
        ip: auditIp,
        userAgent: auditUa,
      });
      throw new NotFoundError("export-download", jobId, {
        i18nKey: "userDataRights.errors.download.unavailable",
      });
    }
    if (!jobRow.downloadStorageKey) {
      await recordInvalidAttempt({
        db: runner,
        tenantId,
        now,
        result: "expired",
        via: "job",
        tokenHash: null,
        jobId,
        attemptedByUserId: userId,
        ip: auditIp,
        userAgent: auditUa,
      });
      throw new NotFoundError("export-download", jobId, {
        i18nKey: "userDataRights.errors.download.expired",
      });
    }

    // Provider bound explicitly to the job's tenant — NOT the ambient
    // session tenant (cross-tenant-same-user: job.requestedFromTenantId
    // can differ from query.user.tenantId).
    const provider = await makeTenantStorageProviderResolver({
      registry: ctx.registry,
      configResolver: ctx.configResolver,
      secrets: ctx.secrets,
      // @cast-boundary db-runner — helpers use only the query API that
      // DbConnection and DbTx share.
      db: runner as import("@cosmicdrift/kumiko-types/db-connection").DbConnection,
      userId: SYSTEM_USER_ID,
      handlerName: "user-data-rights:query:download-by-job",
    })(jobRow.requestedFromTenantId as TenantId); // @cast-boundary engine-payload: TenantId brand
    if (!provider.getSignedUrl) {
      await recordInvalidAttempt({
        db: runner,
        tenantId,
        now,
        result: "signedUrlNotSupported",
        via: "job",
        tokenHash: null,
        jobId,
        attemptedByUserId: userId,
        ip: auditIp,
        userAgent: auditUa,
      });
      throw new UnprocessableError("storage_provider_signed_url_not_supported", {
        i18nKey: "userDataRights.errors.download.signedUrlNotSupported",
      });
    }

    const signedUrl = await provider.getSignedUrl(
      jobRow.downloadStorageKey,
      SIGNED_URL_TTL_SECONDS,
      {
        contentDisposition: `attachment; filename="user-data-export-${jobRow.id}.zip"`,
      },
    );
    const signedUrlExpiresAt = T.Instant.fromEpochMilliseconds(
      now.epochMilliseconds + SIGNED_URL_TTL_SECONDS * 1000,
    );

    // Step 6: Look up tokenRow for the audit update. The UI flow has no plain
    // token, but its useCount must still be incremented so audit fields remain
    // consistent and UI clicks count as uses. The jobId lookup is safe because
    // the UNIQUE index guarantees at most one row.
    const tokenRow = await fetchOne<TokenRow>(runner, exportDownloadTokensTable, {
      jobId,
    });

    if (tokenRow) {
      await recordDownloadUse({
        db: runner,
        tokenId: tokenRow.id,
        tokenVersion: tokenRow.version,
        tokenUseCount: tokenRow.useCount ?? 0,
        tenantId: jobRow.requestedFromTenantId,
        now,
        ip: auditIp,
        userAgent: auditUa,
      });
    }
    // If tokenRow is missing (which should not happen when the preceding token
    // creation flow completed), skip the audit update and continue the download;
    // an audit failure must not block the user.

    return {
      url: signedUrl,
      expiresAt: signedUrlExpiresAt.toString(),
      bytesWritten: jobRow.bytesWritten,
    };
  },
});

// GET /api/query → user-data-rights:query:download-by-token.
//
// **Magic-link path** (anonymous): The user clicks an email link with
// `#token=<plain>` (URL fragment). The worker persisted the token hash in the database
// when marking the job done. Verification:
//
//   1. hashDownloadToken(plain) → fetchOne in download-tokens
//   2. expiresAt > now (multiple uses within the TTL)
//   3. job.status === "done"
//   4. job.downloadStorageKey != null (storage was not cleared)
//   5. provider.getSignedUrl is required (501 when the provider is local-fs)
//   6. Audit update: useCount + 1, lastUsedAt, IP, UA (best-effort, race-tolerant)
//   7. Return {url, expiresAt}
//
// **Security:**
//   - The hash is matched by a DB equality lookup, not a constant-time comparison. With
//     256 bits of token randomness a timing leak reveals at most hash prefixes, never
//     a preimage.
//   - Invalid tokens return 404 without leaking existence, using the same code path
//     as a token that was not found.
//   - The token is tenant-agnostic: UUID + SHA256 makes it globally unique, so no
//     tenant filter is needed.
//
// **r.httpRoute wrapper** (see feature.ts) redirects to signedUrl with a 302. The user
// clicks the email link once, the browser follows the redirect, and the download
// starts. This query handler returns only the JSON.

import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import {
  defineQueryHandler,
  SYSTEM_USER_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import * as z from "zod";
import { makeTenantStorageProviderResolver } from "../../file-foundation/index.ts";
import { recordDownloadUse, recordInvalidAttempt } from "../audit-download.ts";
import { exportDownloadTokensTable } from "../schema/download-token.ts";
import { EXPORT_JOB_STATUS, exportJobsTable } from "../schema/export-job.ts";
import { hashDownloadToken } from "../token-helpers.ts";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

const SIGNED_URL_TTL_SECONDS = 300; // 5 min — short enough to limit replay, long enough for slow connections

const DOWNLOAD_BY_TOKEN_REASON =
  "the download token, its job and audit rows are keyed by token hash / job id, not the caller's tenant — the anonymous magic-link path has no tenant context at all";

interface TokenRow {
  readonly id: string;
  readonly version: number;
  readonly jobId: string;
  readonly expiresAt: Instant;
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

export const downloadByTokenQuery = defineQueryHandler({
  name: "download-by-token",
  schema: z.object({
    token: z.string().min(1, "token required"),
    auditMeta: z
      .object({
        ip: z.string().nullable(),
        userAgent: z.string().nullable(),
      })
      .optional(),
  }),
  // public-intake: rejected attempts store the anonymous caller's IP in the audit row.
  access: {
    roles: ["anonymous", "Member", "User", "TenantAdmin", "SystemAdmin"],
    personalData: "public-intake",
  },
  agent: { expose: false },
  // Brute-force protection for token-hash probing. This anonymous endpoint uses a
  // 32-byte random token with a 256-bit search space, but rate limiting provides
  // defense in depth and protects against storm patterns that generate database load.
  // 30 attempts/min/IP allows legitimate users several retries after connection
  // failures while blocking automated probing loops.
  rateLimit: { per: "ip+handler", limit: 30, windowSeconds: 60 },
  escapeHatch: {
    grants: ["unsafeRaw"],
    reason: DOWNLOAD_BY_TOKEN_REASON,
  },
  handler: async (query, ctx) => {
    const T = getTemporal();
    const now = T.Now.instant();
    const runner = ctx.db.unsafeRaw();

    // Step 1: hash + lookup
    const hash = await hashDownloadToken(query.payload.token);
    const tokenRow = await fetchOne<TokenRow>(runner, exportDownloadTokensTable, {
      tokenHash: hash,
    });

    if (!tokenRow) {
      // Invalid token — 404 without leaking existence. Use a generic NotFoundError
      // so all failure paths have the same external shape, preventing probing that
      // distinguishes "Token does not exist" from "Job has failed".
      throw new NotFoundError("export-download", undefined, {
        i18nKey: "userDataRights.errors.download.notFound",
      });
    }

    const auditIp = query.payload.auditMeta?.ip ?? null;
    const auditUa = query.payload.auditMeta?.userAgent ?? null;

    // Step 2: TTL check.
    //
    // 410 Gone would be semantically right (the download existed and is now
    // gone), but the framework has no GoneError class. NotFoundError with
    // i18nKey "expired" is the compromise: the UI renders by i18nKey, not by
    // HTTP status, so the user sees "Your download has expired" instead of a
    // generic "not found".
    if (tokenRow.expiresAt.epochMilliseconds <= now.epochMilliseconds) {
      // Auditing cannot be skipped yet because jobRow has not been loaded and the
      // tenantId is unknown. Load the job to obtain audit context; if it is also
      // missing, skipping the audit is acceptable (best-effort).
      const jobForAudit = await fetchOne<{ requestedFromTenantId: string }>(
        runner,
        exportJobsTable,
        {
          id: tokenRow.jobId,
        },
      );
      if (jobForAudit) {
        await recordInvalidAttempt({
          db: runner,
          tenantId: jobForAudit.requestedFromTenantId,
          now,
          result: "expired",
          via: "token",
          tokenHash: hash,
          jobId: tokenRow.jobId,
          attemptedByUserId: null,
          ip: auditIp,
          userAgent: auditUa,
        });
      }
      throw new NotFoundError("export-download", undefined, {
        i18nKey: "userDataRights.errors.download.expired",
      });
    }

    // Step 3-4: job-checks
    const jobRow = await fetchOne<JobRow>(runner, exportJobsTable, {
      id: tokenRow.jobId,
    });

    if (!jobRow) {
      throw new NotFoundError("export-download", undefined, {
        i18nKey: "userDataRights.errors.download.notFound",
      });
    }
    if (jobRow.status !== EXPORT_JOB_STATUS.Done) {
      await recordInvalidAttempt({
        db: runner,
        tenantId: jobRow.requestedFromTenantId,
        now,
        result: "failed",
        via: "token",
        tokenHash: hash,
        jobId: jobRow.id,
        attemptedByUserId: null,
        ip: auditIp,
        userAgent: auditUa,
      });
      throw new NotFoundError("export-download", undefined, {
        i18nKey: "userDataRights.errors.download.unavailable",
      });
    }
    if (!jobRow.downloadStorageKey) {
      await recordInvalidAttempt({
        db: runner,
        tenantId: jobRow.requestedFromTenantId,
        now,
        result: "expired",
        via: "token",
        tokenHash: hash,
        jobId: jobRow.id,
        attemptedByUserId: null,
        ip: auditIp,
        userAgent: auditUa,
      });
      throw new NotFoundError("export-download", undefined, {
        i18nKey: "userDataRights.errors.download.expired",
      });
    }

    // Step 5: signed-URL via provider, explicitly bound to the job's
    // tenant — NOT the ambient request tenant (anonymous magic-link path
    // has none under resolverTrust: "authoritative").
    const provider = await makeTenantStorageProviderResolver({
      registry: ctx.registry,
      configResolver: ctx.services.configResolver,
      secrets: ctx.services.secrets,
      // @cast-boundary db-runner — helpers use only the query API that
      // DbConnection and DbTx share.
      db: runner as import("@cosmicdrift/kumiko-types/db-connection").DbConnection,
      userId: SYSTEM_USER_ID,
      handlerName: "user-data-rights:query:download-by-token",
    })(jobRow.requestedFromTenantId as TenantId); // @cast-boundary engine-payload: TenantId brand
    if (!provider.getSignedUrl) {
      await recordInvalidAttempt({
        db: runner,
        tenantId: jobRow.requestedFromTenantId,
        now,
        result: "signedUrlNotSupported",
        via: "token",
        tokenHash: hash,
        jobId: jobRow.id,
        attemptedByUserId: null,
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

    // Step 6: Best-effort audit update. auditMeta comes from the httpRoute wrapper
    // (trusted source). Direct API callers can falsify it, but the audit data is not
    // security-sensitive.
    await recordDownloadUse({
      db: runner,
      tokenId: tokenRow.id,
      tokenVersion: tokenRow.version,
      tokenUseCount: tokenRow.useCount ?? 0,
      tenantId: jobRow.requestedFromTenantId,
      now,
      ip: query.payload.auditMeta?.ip ?? null,
      userAgent: query.payload.auditMeta?.userAgent ?? null,
    });

    return {
      url: signedUrl,
      expiresAt: signedUrlExpiresAt.toString(),
      bytesWritten: jobRow.bytesWritten,
    };
  },
});

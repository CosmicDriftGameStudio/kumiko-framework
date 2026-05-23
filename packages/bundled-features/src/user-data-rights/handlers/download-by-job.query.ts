// GET /api/query → user-data-rights:query:download-by-job (S2.U3 Atom 4b).
//
// **UI-Klick-Pfad** (session-auth): User pollt status, sieht "done",
// klickt "Download" im UI mit jobId. Server checkt session.userId ==
// job.userId — kein Token noetig (Session IS the auth).
//
// **Cross-Tenant-Same-User:** Job ist tenant-agnostisch (1 Job pro
// userId ueber alle Memberships). Alice triggert Export aus Tenant A,
// loggt sich spaeter in Tenant B ein, klickt Download. Server akzeptiert
// — `session.userId == job.userId` reicht, kein Tenant-Match-Check.
// Plan-Decision (Atom 4b Plan, User-Choice).
//
// **Cross-User-Isolation:** Wenn session.userId != job.userId → 404
// (NICHT 403, kein Existenz-Leak). Selber error wie "Job-ID nicht
// gefunden".
//
// Verify-Pipeline:
//   1. fetchOne job by jobId
//   2. job.userId === session.userId (cross-user-isolation)
//   3. job.status === "done"
//   4. job.downloadStorageKey != null
//   5. tokenRow lookup (audit-row update only)
//   6. Audit-Update: useCount + 1, IP, UA, lastUsedAt (best-effort)
//   7. Return {url, expiresAt}

import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createFileProviderForTenant } from "../../file-foundation";
import { recordDownloadUse, recordInvalidAttempt } from "../audit-download";
import { exportDownloadTokensTable } from "../schema/download-token";
import { EXPORT_JOB_STATUS, exportJobsTable } from "../schema/export-job";

const SIGNED_URL_TTL_SECONDS = 300; // 5 min — matched download-by-token

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
    auditMeta: z
      .object({
        ip: z.string().nullable(),
        userAgent: z.string().nullable(),
      })
      .optional(),
  }),
  access: { openToAll: true }, // openToAll = auth-required, kein anonymous
  handler: async (query, ctx) => {
    const T = getTemporal();
    const now = T.Now.instant();
    const userId = query.user.id;
    const jobId = query.payload.jobId;
    const tenantId = query.user.tenantId;
    const auditIp = query.payload.auditMeta?.ip ?? null;
    const auditUa = query.payload.auditMeta?.userAgent ?? null;

    // Step 1-2: job-lookup + cross-user-isolation
    // ctx.db.raw weil tenant-agnostisch — Alice in Tenant B sucht den
    // aus Tenant A erstellten Job.
    const jobRow = await fetchOne<JobRow>(
      ctx.db.raw,
      exportJobsTable,
      eq(exportJobsTable["id"], jobId),
    );

    if (!jobRow || jobRow.userId !== userId) {
      await recordInvalidAttempt({
        db: ctx.db.raw,
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
        db: ctx.db.raw,
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
        db: ctx.db.raw,
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

    const provider = await createFileProviderForTenant(
      ctx,
      jobRow.requestedFromTenantId,
      "user-data-rights:query:download-by-job",
    );
    if (!provider.getSignedUrl) {
      await recordInvalidAttempt({
        db: ctx.db.raw,
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

    // Step 6: Audit-Update via tokenRow-lookup. UI-Pfad benutzt nicht
    // den plain-Token, aber wir wollen den useCount inkrementieren
    // damit die Audit-Felder konsistent sind (UI-clicks zaehlen auch
    // als Use). Lookup via jobId — UNIQUE-Index garantiert max 1 Row.
    const tokenRow = await fetchOne<TokenRow>(
      ctx.db.raw,
      exportDownloadTokensTable,
      eq(exportDownloadTokensTable["jobId"], jobId),
    );

    if (tokenRow) {
      await recordDownloadUse({
        db: ctx.db.raw,
        tokenId: tokenRow.id,
        tokenVersion: tokenRow.version,
        tokenUseCount: tokenRow.useCount ?? 0,
        tenantId: jobRow.requestedFromTenantId,
        now,
        ip: query.payload.auditMeta?.ip ?? null,
        userAgent: query.payload.auditMeta?.userAgent ?? null,
      });
    }
    // Wenn tokenRow fehlt (sollte nicht passieren wenn Atom 4a sauber
    // lief): Audit-Update skipped, Download laeuft weiter. Niemand wird
    // hier durch Audit-Failure blockiert.

    return {
      url: signedUrl,
      expiresAt: signedUrlExpiresAt.toString(),
      bytesWritten: jobRow.bytesWritten,
    };
  },
});

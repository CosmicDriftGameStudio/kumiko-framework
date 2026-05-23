// GET /api/query → user-data-rights:query:download-by-token (S2.U3 Atom 4b).
//
// **Magic-Link-Pfad** (anonymous): User klickt Email-Link mit
// `?token=<plain>`. Worker hat beim done-flip Token-Hash in DB
// persistiert (Atom 4a). Verify-Pipeline:
//
//   1. hashDownloadToken(plain) → fetchOne in download-tokens
//   2. expiresAt > now (Multi-use within TTL — Plan-Decision)
//   3. job.status === "done"
//   4. job.downloadStorageKey != null (storage nicht gecleared)
//   5. provider.getSignedUrl pflicht (501 wenn Provider local-fs ist)
//   6. Audit-Update: useCount + 1, lastUsedAt, IP, UA (best-effort, race-tolerant)
//   7. Return {url, expiresAt}
//
// **Sicherheit:**
//   - Token-Hash-Compare via DB-fetchOne (nicht constant-time, aber
//     timing-attacks auf SHA256-bytes brauchen >>10k requests + stable
//     latenz — in Web-App-Kontext nicht ausnutzbar). Plan-Decision: harden
//     wenn Pen-Test es flaggt.
//   - 404 bei invalidem Token (kein Existenz-Leak) — gleicher Code-Pfad
//     wie nicht-gefundenes Token.
//   - tenant-agnostic: Token ist global eindeutig (UUID + SHA256), kein
//     Tenant-Filter nötig.
//
// **r.httpRoute-Wrapper** (siehe feature.ts) macht 302-Redirect zu
// signedUrl — User klickt 1× Email-Link, Browser folgt redirect, Download
// startet. Dieser query-handler liefert nur das JSON.

import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { z } from "zod";
import { createFileProviderForTenant } from "../../file-foundation";
import { recordDownloadUse, recordInvalidAttempt } from "../audit-download";
import { exportDownloadTokensTable } from "../schema/download-token";
import { EXPORT_JOB_STATUS, exportJobsTable } from "../schema/export-job";
import { hashDownloadToken } from "../token-helpers";

type Instant = InstanceType<ReturnType<typeof getTemporal>["Instant"]>;

const SIGNED_URL_TTL_SECONDS = 300; // 5 min — kurz genug fuer Replay-Schutz, lang genug fuer slow connections

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
  access: { roles: ["anonymous", "Member", "User", "TenantAdmin", "SystemAdmin"] },
  // Brute-Force-Schutz fuer Token-Hash-Probing. Anonymous-Endpoint mit
  // 32-byte-Random-Token = 256 Bit Search-Space, aber rate-limit als
  // defense-in-depth + Schutz gegen Storm-Patterns die DB-Last erzeugen.
  // 30 attempts/min/IP reicht fuer legitime User (mehrere Klicks bei
  // Connection-Abbruch); blockiert automatisierte Probing-Loops.
  // Memory `feedback_security_default_on`.
  rateLimit: { per: "ip", limit: 30, windowSeconds: 60 },
  handler: async (query, ctx) => {
    const T = getTemporal();
    const now = T.Now.instant();

    // Step 1: hash + lookup
    const hash = await hashDownloadToken(query.payload.token);
    // ctx.db.raw weil Token+Job tenant-agnostisch — anonymous-pfad hat
    // keinen tenant-context im query.user.
    const tokenRow = await fetchOne<TokenRow>(ctx.db.raw, exportDownloadTokensTable, {
      tokenHash: hash,
    });

    if (!tokenRow) {
      // Invalid token — 404 ohne Existenz-Leak. Generic NotFoundError
      // damit alle Failure-Pfade die gleiche externe Shape haben (kein
      // Probing zwischen "Token existiert nicht" vs "Job ist failed").
      throw new NotFoundError("export-download", undefined, {
        i18nKey: "userDataRights.errors.download.notFound",
      });
    }

    const auditIp = query.payload.auditMeta?.ip ?? null;
    const auditUa = query.payload.auditMeta?.userAgent ?? null;

    // Step 2: TTL-check.
    //
    // **Pragma:** semantisch waere 410 Gone richtig (war mal da, jetzt
    // nicht mehr). Framework hat keine GoneError-Class; wir nutzen
    // NotFoundError + i18nKey "expired" als Kompromiss. UI rendert
    // anhand des i18nKeys, nicht des HTTP-Status — also User sieht
    // "Dein Download ist abgelaufen", nicht generic "not found".
    if (tokenRow.expiresAt.epochMilliseconds <= now.epochMilliseconds) {
      // Audit-Skip noch nicht moeglich — jobRow noch nicht geladen,
      // tenantId unbekannt. Wir laden den Job hier noch fuer Audit-Context
      // (best-effort — wenn Job auch fehlt, audit-skip ist akzeptabel).
      const jobForAudit = await fetchOne<{ requestedFromTenantId: string }>(
        ctx.db.raw,
        exportJobsTable,
        { id: tokenRow.jobId },
      );
      if (jobForAudit) {
        await recordInvalidAttempt({
          db: ctx.db.raw,
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
    const jobRow = await fetchOne<JobRow>(ctx.db.raw, exportJobsTable, {
      id: tokenRow.jobId,
    });

    if (!jobRow) {
      throw new NotFoundError("export-download", undefined, {
        i18nKey: "userDataRights.errors.download.notFound",
      });
    }
    if (jobRow.status !== EXPORT_JOB_STATUS.Done) {
      await recordInvalidAttempt({
        db: ctx.db.raw,
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
        db: ctx.db.raw,
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

    // Step 5: signed-URL via provider. createFileProviderForTenant nutzt
    // requestedFromTenantId (gleicher Tenant wie beim Worker-Storage-Write).
    const provider = await createFileProviderForTenant(
      ctx,
      jobRow.requestedFromTenantId,
      "user-data-rights:query:download-by-token",
    );
    if (!provider.getSignedUrl) {
      await recordInvalidAttempt({
        db: ctx.db.raw,
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

    // Step 6: Audit-Update best-effort. auditMeta kommt vom httpRoute-
    // Wrapper (trusted-source). Direct-API-caller koennen luegen, aber
    // Audit ist nicht security-relevant.
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

    return {
      url: signedUrl,
      expiresAt: signedUrlExpiresAt.toString(),
      bytesWritten: jobRow.bytesWritten,
    };
  },
});

import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

// Audit trail for rejected download attempts.
// Writes one row per 4xx response on the download-by-{token,job} path, allowing the DPO
// to detect brute-force probing and anomalies such as many invalid attempts from one IP.
// Successful downloads are recorded in download-token.lastUsedAt instead.
export const downloadAttemptEntity = createEntity({
  table: "read_download_attempts",
  idType: "uuid",
  description:
    "One rejected attempt to fetch a GDPR data-export download, recording the failure result, the path used (magic-link token or logged-in job id), the source IP, user agent and time, so brute-force probing of download links is visible.",
  fields: {
    // notFound | expired | failed | signedUrlNotSupported
    result: createTextField({
      required: true,
      maxLength: 32,
      personal: false,
      reason: "technical_reference",
    }),
    // Welcher Pfad: "token" | "job"
    via: createTextField({
      required: true,
      maxLength: 16,
      personal: false,
      reason: "technical_reference",
    }),
    // Token hash for the token path, or NULL for the job path or an unknown token.
    tokenHash: createTextField({ maxLength: 64, personal: false, reason: "technical_reference" }),
    // Job ID when the attempt identified one; NULL for an unknown token.
    jobId: createTextField({ personal: false, reason: "technical_reference" }),
    // User ID for the authenticated job path; NULL for anonymous token-path requests.
    attemptedByUserId: createTextField({ personal: false, reason: "pseudonymous_fk" }),
    // The anonymous token path has no owner, so those rows fall back to the tenant key;
    // find "exact" on ip because list-download-attempts filters by IP.
    ip: createTextField({
      maxLength: 64,
      personal: { of: "attemptedByUserId", whenAbsent: "tenant" },
      find: "exact",
    }),
    userAgent: createTextField({
      maxLength: 256,
      personal: { of: "attemptedByUserId", whenAbsent: "tenant" },
      find: "none",
    }),
    attemptedAt: createTimestampField({ required: true }),
  },
  // 90d hardDelete: unbounded growth would create a disk bomb targeting the system
  // that detects brute-force activity. Brute-force patterns are short-lived (hours to days),
  // while a 90d window covers forensic reviews and quarterly DPO audits.
  // The tenant can extend retention through an override for HR compliance.
  retention: { keepFor: "90d", strategy: "hardDelete", reference: "attemptedAt" },
});

export const downloadAttemptsTable = buildEntityTable("downloadAttempt", downloadAttemptEntity);

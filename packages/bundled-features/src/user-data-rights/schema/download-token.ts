import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createBigIntField,
  createEntity,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

// Export-Download-Token.
//
// Security token for the download endpoint. Pattern:
//   1. Worker generates a plain token (32 random bytes, base64url) +
//      hash (SHA256 hex) when flipping to done.
//   2. crud.create(downloadTokenEntity, ...) emits
//      `exportDownloadToken.created`-Event in the event store. The DB row
//      is written synchronously via the projection (Marten pattern, NOT
//      direct INSERT).
//   3. Plain token remains in worker memory + is passed via
//      RunExportJobsResult to the notification flow. NEVER plain in DB.
//   4. The download endpoint hashes the incoming token + looks up the
//      row by tokenHash equality. This is a plain DB lookup,
//      not a constant-time comparison: the token carries 256 bits of
//      randomness, so a timing leak can reveal at most hash prefixes,
//      never a preimage.
//
// **Multi-use within TTL**: Token is not "consumed" on download.
// Multiple downloads until expiresAt are allowed — better UX for connection
// interruptions, no forced re-export. Pattern matches Google Takeout (7d)
// + Facebook Data Download (4d).
//
// **TTL = job.expiresAt** (denormalized, same value as the job row).
// Storage cleanup nulls downloadStorageKey after
// expiresAt + exportStorageCleanupGraceHours. The token row remains
// (audit trail) — the download endpoint checks job.downloadStorageKey
// != null before streaming + returns 410 Gone when storage is cleared.
//
// **idType: "uuid"** matches ExportJob — token IDs cross process
// boundaries (audit events for the DPO, possible re-issue paths).

export const exportDownloadTokenEntity = createEntity({
  table: "read_export_download_tokens",
  idType: "uuid",

  fields: {
    // Foreign key to export jobs. UNIQUE (see indexes) enforces one token per
    // job. A separate token row keeps token-specific audit fields
    // (`lastUsedAt`/IP/UA) separate from the job.
    jobId: createTextField({
      required: true,
      personal: false,
      reason: "technical_reference",
    }),

    // **Hash, never plain.** SHA256 hex (64 chars), looked up by equality.
    tokenHash: createTextField({
      required: true,
      maxLength: 64,
      personal: false,
      reason: "technical_reference",
    }),

    // The time the token was issued, when the job was marked done.
    issuedAt: createTimestampField({
      required: true,
    }),

    // The token expires at the same time as `job.expiresAt`; the worker sets both
    // values when marking the job done.
    expiresAt: createTimestampField({
      required: true,
    }),

    // Audit timestamp for the most recent download. NULL means the token has
    // never been downloaded; the endpoint updates it after each successful
    // stream.
    lastUsedAt: createTimestampField({}),

    // Audit count of downloads. `bigInt` accommodates pathological re-download
    // loops, such as those caused by a broken sync tool.
    useCount: createBigIntField({}),

    // Audit: source IP of the last download. Helps the DPO investigate
    // unusual activity ("token was used from 5 different IPs"). Plain
    // IPv4/IPv6, no hash — DPO needs it directly readable.
    // `reason: "is_business_data"` because token-audit data isn't user
    // PII (it belongs to the tenant operator).
    lastUsedFromIp: createTextField({
      maxLength: 45,
      personal: false,
      reason: "is_business_data",
    }),

    // Audit: user agent of the last download (distinguishes email
    // client vs browser vs CLI tool). Same `reason` as above.
    lastUsedUserAgent: createTextField({
      maxLength: 500,
      personal: false,
      reason: "is_business_data",
    }),
  },

  // UNIQUE on `jobId` provides an idempotency backstop: rerunning a completed
  // job must not create a second token aggregate. Re-runs update the existing
  // token in place; otherwise projection rebuilds would collide on this index.
  indexes: [
    {
      unique: true,
      columns: ["jobId"],
      name: "read_export_download_tokens_one_per_job",
    },
  ],
});

export const exportDownloadTokensTable = buildEntityTable(
  "exportDownloadToken",
  exportDownloadTokenEntity,
);

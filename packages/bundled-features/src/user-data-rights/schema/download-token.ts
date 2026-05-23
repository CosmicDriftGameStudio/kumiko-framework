import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createBigIntField,
  createEntity,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

// Export-Download-Token (S2.U3 Atom 4a).
//
// Sicherheits-Token fuer den Download-Endpoint (Atom 4b). Pattern:
//   1. Worker generiert plain-Token (32 byte random base64url) +
//      Hash (SHA256 hex) beim Flip auf done.
//   2. crud.create(downloadTokenEntity, ...) emittiert
//      `exportDownloadToken.created`-Event in den event-store. DB-Row
//      wird via Projection synchron geschrieben (Marten-Pattern, NICHT
//      direct-INSERT). Memory `feedback_event_store_tenant_consistency`.
//   3. Plain bleibt im Worker-Memory + wird via RunExportJobsResult an
//      Atom 5 (Notification) weitergegeben. NIEMALS plain in DB.
//   4. Atom 4b's Download-Endpoint: hashed incoming-Token + sucht den
//      Hash-Eintrag. Konstanter-Zeit-Vergleich gegen timing-attacks.
//
// **Multi-use within TTL** (Plan-Decision 4a): Token wird beim Download
// nicht "consumed". Mehrfach-Download bis expiresAt erlaubt — UX bei
// Connection-Abbrueche, kein Re-Export-Zwang. Pattern matched Google-
// Takeout (7d) + Facebook-Data-Download (4d).
//
// **TTL = job.expiresAt** (denormalized, gleicher Wert wie Job-Row).
// Storage-Cleanup-Pass nullt downloadStorageKey nach
// expiresAt + exportStorageCleanupGraceHours. Token-Row bleibt liegen
// (Audit-Trail) — Atom 4b's Download-Endpoint check't job.downloadStorageKey
// != null vor Streaming + returns 410 Gone wenn Storage cleared.
//
// **idType: "uuid"** matched ExportJob — Token-IDs reisen ueber
// Process-Grenzen (audit-events fuer DPO, ggf. Re-Issue-Pfade).

export const exportDownloadTokenEntity = createEntity({
  table: "read_export_download_tokens",
  idType: "uuid",

  fields: {
    // FK auf export-jobs. UNIQUE (siehe indexes) — 1 Token pro Job.
    // Audit-Trail-Argument: separate Token-Row statt Job-Spalten weil
    // Audit-Felder (lastUsedAt/IP/UA) semantisch zum Token, nicht zum
    // Job gehoeren.
    jobId: createTextField({
      required: true,
    }),

    // **Hash NICHT plain.** SHA256-hex (64 chars). Atom 4b verifiziert
    // via konstanter-Zeit-Vergleich.
    tokenHash: createTextField({
      required: true,
      maxLength: 64,
    }),

    // Wann wurde das Token ausgegeben (= Job-Done-Flip-Zeit).
    issuedAt: createTimestampField({
      required: true,
    }),

    // Wann laeuft das Token ab. Identisch zu job.expiresAt
    // (denormalized — Worker setzt beide gleich beim Done-Flip).
    expiresAt: createTimestampField({
      required: true,
    }),

    // Audit: wann wurde das Token zuletzt fuer einen Download genutzt.
    // NULL solange noch nie heruntergeladen. Atom 4b's Download-Endpoint
    // setzt es bei jedem successful Stream.
    lastUsedAt: createTimestampField({}),

    // Audit: Anzahl der Downloads. Atom 4b incrementiert bei jedem
    // Stream. bigInt fuer fall einer pathologischer Re-Download-Schleife
    // (z.B. broken Sync-Tool).
    useCount: createBigIntField({}),

    // Audit: Source-IP des letzten Downloads. Hilft DPO bei Untersuchung
    // ungewoehnlicher Aktivitaeten ("Token wurde von 5 verschiedenen
    // IPs genutzt"). Plain-IP-V4/IPv6, kein hash — DPO braucht direkt
    // lesbar. is-business-data weil Token-Audit kein User-PII ist
    // (gehoert dem Tenant-Operator).
    lastUsedFromIp: createTextField({
      maxLength: 45, // IPv6 max
      allowPlaintext: "is-business-data",
    }),

    // Audit: User-Agent des letzten Downloads. Audit-Wert (Email-Client
    // vs Browser vs CLI-Tool unterscheidbar). is-business-data analog.
    lastUsedUserAgent: createTextField({
      maxLength: 500,
      allowPlaintext: "is-business-data",
    }),
  },

  // 1 Token pro Job. UNIQUE auf jobId — garantiert dass Worker-
  // Idempotency (Atom 3b's "2× run done-Job → no-op") auch fuer
  // Token-Generierung gilt: zweiter Versuch faellt auf Constraint.
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

import { buildDrizzleTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createBigIntField,
  createEntity,
  createLongTextField,
  createSelectField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";
import { sql } from "@cosmicdrift/kumiko-framework/db";

// Export-Job-Lifecycle (S2.U3+U4 Atom 1).
//
// Spec: docs/plans/architecture/user-data-rights.md "Async Export-Pipeline".
// User triggert `request-export` → ExportJob (status="pending"). Worker
// pickt auf → "running" → erfolgreich "done" + downloadStorageKey gesetzt
// + expiresAt = completedAt + compliance-profile.userRights.exportDownloadTtl
// (per-Tenant-konfigurierbar via Override, Default 7 Tage). Bei Throw
// oder Stale-Timeout → "failed" mit errorMessage. Stale-Timeout +
// Storage-Cleanup-Grace ebenfalls aus dem compliance-profile.
//
// Status-Werte als Constants — Single source of truth fuer Worker,
// Application-Code (request-export-Handler), UI-Banner (Polling) und
// Drift-Guard im Test.
export const EXPORT_JOB_STATUS = {
  Pending: "pending",
  Running: "running",
  Done: "done",
  Failed: "failed",
} as const;

export type ExportJobStatus = (typeof EXPORT_JOB_STATUS)[keyof typeof EXPORT_JOB_STATUS];

/**
 * DB-Constraint-Name fuer den Partial-UNIQUE-Index (1 aktiver Job pro
 * User). Single source of truth — request-export.write catched 23505
 * mit diesem Namen als Race-Schutz, Tests pinnen ihn als
 * `expectUniqueViolation`-Argument. Rename hier propagiert automatisch.
 */
export const ACTIVE_JOB_CONSTRAINT = "read_export_jobs_one_active_per_user";

const EXPORT_JOB_STATUS_OPTIONS = [
  EXPORT_JOB_STATUS.Pending,
  EXPORT_JOB_STATUS.Running,
  EXPORT_JOB_STATUS.Done,
  EXPORT_JOB_STATUS.Failed,
] as const;

// **Tenant-agnostisch** wie userTable — 1 Job pro {userId} ueber alle
// Memberships. Die Framework-Auto-`tenant_id`-Spalte ist da, wird aber
// in der Domain ignoriert (Cross-Tenant-Iteration laeuft im Worker via
// ctx.db.raw, gleiches Pattern wie runForgetCleanup).
//
// **Idempotency:** Partial-UNIQUE-Index auf `(userId)` WHERE
// `status IN ('pending', 'running')`. User mit pending-Job kann keinen
// zweiten parallelen Job starten — der Insert faellt mit Constraint-
// Violation auf, der request-export-Handler (Atom 2) faengt das ab und
// returnt den existing pending-Job (Insert-or-Return). Race-Window
// null. Done/Failed-Jobs koennen beliebig viele pro User existieren
// (Audit-Historie).
//
// **idType: "uuid"** — Job-IDs reisen ueber Process-Grenzen
// (BullMQ-Payload, Job-Run-Logger, Audit-Events fuer DPO). Serial-IDs
// sind nur prozess-lokal verlaesslich, UUIDs cross-process stabil.
export const exportJobEntity = createEntity({
  table: "read_export_jobs",
  idType: "uuid",

  fields: {
    // Tenant-agnostisch: Wert wird beim Schreiben gesetzt (Framework
    // braucht eine tenant_id-Spalte), domain-mäßig ignoriert.
    // Kein maxLength — folgt userTable.id + tenantMembershipsTable.userId
    // (beide ohne maxLength). UserId-Form ist Plattform-Konzern, hier
    // nur Storage.
    userId: createTextField({
      required: true,
    }),

    // **requestedFromTenantId** — der Tenant aus dem der User den Antrag
    // gestellt hat. Persistierter Audit-Pfad fuer den Worker (welches
    // Compliance-Profile gilt fuer Job-TTL/Stale/Cleanup) — DSGVO-
    // konsistent: 1 User = 1 effektives Profile pro Antrag, nicht "wechselt
    // mit jedem Cross-Tenant-Klick". Plan-Doc-Decision: Tenant aus 1. Klick
    // (Option a). Spalte heisst nicht einfach "tenantId" damit kein
    // Verwechseln mit der Framework-Auto-Spalte tenant_id.
    //
    // **Atom 3b Worker-Hinweis:** Profile-Resolution muss ueber
    // `requestedFromTenantId` laufen (`queryAs(systemUserOf(requestedFromTenantId),
    // "compliance-profiles:query:for-tenant", {})`), NICHT ueber
    // `executor.tenantId` — sonst kriegt ein Job-Pickup aus einem anderen
    // Tenant-Context ein falsches Profile.
    requestedFromTenantId: createTextField({
      required: true,
    }),

    status: createSelectField({
      required: true,
      default: EXPORT_JOB_STATUS.Pending,
      options: EXPORT_JOB_STATUS_OPTIONS,
    }),

    // Wann hat der User den Job angefordert. Required — kein Job-Row
    // entsteht ohne Klick.
    requestedAt: createTimestampField({
      required: true,
    }),

    // Wann hat der Worker mit dem Pickup angefangen. NULL solange
    // `pending`. Stale-Detection nutzt das +
    // compliance-profile.userRights.exportStaleTimeoutMinutes.
    startedAt: createTimestampField({}),

    // Wann hat der Worker abgeschlossen (success oder fail). NULL
    // solange running.
    completedAt: createTimestampField({}),

    // Storage-Key des fertigen ZIP-Files. NULL solange nicht `done`.
    // Worker setzt das + die ZIP-Bytes via storage-provider.write(key).
    // Dies ist KEIN signed-URL — der Download-Endpoint generiert den
    // signed-URL on demand vom Storage-Provider (Atom 4).
    downloadStorageKey: createTextField({
      maxLength: 500,
    }),

    // Ab wann ist der Download nicht mehr abrufbar. Worker setzt
    // `completedAt + compliance-profile.userRights.exportDownloadTtl`
    // beim Flip auf `done`. NULL fuer pending/running/failed.
    //
    // Storage-Cleanup-Pflicht: Worker laesst nach
    // `expiresAt + compliance-profile.userRights.exportStorageCleanupGraceHours`
    // einen separaten Pass loeschen damit abgelaufene ZIPs nicht auf S3
    // verbleiben.
    expiresAt: createTimestampField({}),

    // Failed-State Diagnose. longText weil Hook-Errors mit Stack-Trace
    // mehrere KB werden koennen. is-business-data weil Job-Status
    // public im UI-Polling sichtbar (kein PII).
    errorMessage: createLongTextField({
      allowPlaintext: "is-business-data",
    }),

    // Audit-Info fuer Operator: wie gross war der Export. Hilft beim
    // Capacity-Planning + erkennt pathologische Cases (Streaming-ZIP
    // mit 5 GB Files schreibt mehrere Mrd Bytes, integer-Overflow waere
    // silent + Audit-Drift).
    //
    // bigInt liefert JS-`number` Round-trip via mode:"number" — sicher
    // bis 2^53 ≈ 9 PB, JSON-tauglich fuer das Status-Polling.
    bytesWritten: createBigIntField({}),
  },

  // Partial-UNIQUE-Index: nur 1 aktiver Job pro User, Done/Failed-
  // Historie ist unbeschraenkt. request-export.write nutzt App-side-
  // Pre-Check als primaeren Pfad + 23505-Catch dieser Constraint als
  // Race-Schutz fuer das <1ms-Window zwischen fetchOne + crud.create.
  indexes: [
    {
      unique: true,
      columns: ["userId"],
      name: ACTIVE_JOB_CONSTRAINT,
      where: sql`status IN ('pending', 'running')`,
    },
  ],
});

export const exportJobsTable = buildDrizzleTable("exportJob", exportJobEntity);

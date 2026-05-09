import { buildDrizzleTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createLongTextField,
  createNumberField,
  createSelectField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

// Export-Job-Lifecycle (S2.U3+U4 Atom 1).
//
// Spec: docs/plans/architecture/user-data-rights.md "Async Export-Pipeline".
// User triggert `request-export` → ExportJob (status="pending"). Worker
// pickt auf → "running" → erfolgreich "done" + downloadStorageKey gesetzt
// + expiresAt = completedAt + EXPORT_DOWNLOAD_TTL_DAYS. Bei Throw oder
// Stale-Timeout → "failed" mit errorMessage.
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
// Idempotency-Hinweis: kein DB-UNIQUE-Constraint auf (userId, status)
// weil ein User legitimate mehrere `done`/`failed`-Jobs hat (Audit-
// Historie). Doppelklick-Schutz wird im request-export-Handler in
// Atom 2 application-side via SELECT-then-INSERT geloest. Race-Window
// klein, tolerable; partial-Index `WHERE status IN ('pending','running')`
// koennte spaeter als DB-Hardening rein wenn realer Bedarf.
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
    // `pending`. Stale-Detection nutzt das + EXPORT_STALE_TIMEOUT_MINUTES
    // (siehe constants.ts).
    startedAt: createTimestampField({
    }),

    // Wann hat der Worker abgeschlossen (success oder fail). NULL
    // solange running.
    completedAt: createTimestampField({
    }),

    // Storage-Key des fertigen ZIP-Files. NULL solange nicht `done`.
    // Worker setzt das + die ZIP-Bytes via storage-provider.write(key).
    // Dies ist KEIN signed-URL — der Download-Endpoint generiert den
    // signed-URL on demand vom Storage-Provider (Atom 4).
    downloadStorageKey: createTextField({
      maxLength: 500,
    }),

    // Ab wann ist der Download nicht mehr abrufbar. Worker setzt
    // `completedAt + EXPORT_DOWNLOAD_TTL_DAYS` beim Flip auf `done`.
    // NULL fuer pending/running/failed.
    //
    // Storage-Cleanup-Pflicht: Worker laesst nach `expiresAt + EXPORT_
    // STORAGE_CLEANUP_GRACE_HOURS` einen separaten Pass loeschen damit
    // abgelaufene ZIPs nicht auf S3 verbleiben.
    expiresAt: createTimestampField({
    }),

    // Failed-State Diagnose. longText weil Hook-Errors mit Stack-Trace
    // mehrere KB werden koennen. is-business-data weil Job-Status
    // public im UI-Polling sichtbar (kein PII).
    errorMessage: createLongTextField({
      allowPlaintext: "is-business-data",
    }),

    // Audit-Info fuer Operator: wie gross war der Export. Hilft beim
    // Capacity-Planning + erkennt Pathologische Cases (5GB-User triggert
    // Job, der Job-Worker raucht ab, error="OOM" → bytesWritten zeigt
    // wann es kollabierte).
    //
    // **Type-Limit:** createNumberField mappt auf integer (signed 32-bit,
    // ~2 GB cap). Fuer den Audit-Use-Case ausreichend — Worker ist
    // memory-bound bei JSZip in-memory, ZIPs >2 GB kollabieren vorher mit
    // OOM. Bei aenderbarer Production-Realitaet: Framework-Helper
    // `createBigIntField` adden (existiert noch nicht).
    bytesWritten: createNumberField({}),
  },
});

export const exportJobsTable = buildDrizzleTable("exportJob", exportJobEntity);

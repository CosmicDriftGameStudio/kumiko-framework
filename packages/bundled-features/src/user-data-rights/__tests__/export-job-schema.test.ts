// Drift-Guard fuer ExportJob-Schema (S2.U3+U4 Atom 1).
//
// Pinst dass:
//   - EXPORT_JOB_STATUS Constants stabil bleiben (Worker-State-Machine
//     + UI-Polling lesen die Werte als Magic-Strings, jede Aenderung
//     ist ein Breaking-Change).
//   - Export-Konstanten haben sinnvolle Werte (TTL > 0, Stale-Timeout
//     > 0, Cleanup-Grace > 0).
//   - exportJobEntity hat alle Felder die Worker + Handler erwarten —
//     wenn jemand `expiresAt` umbenennt, faellt dieser Test um statt
//     der Worker erst in Production.
//
// Schema-Snapshot, kein Behavior-Test. Behavior-Tests kommen mit Atom 2
// (request-export.write.ts) + Atom 3 (Worker).

import { describe, expect, test } from "vitest";
import {
  EXPORT_DOWNLOAD_TTL_DAYS,
  EXPORT_STALE_TIMEOUT_MINUTES,
  EXPORT_STORAGE_CLEANUP_GRACE_HOURS,
} from "../constants";
import { EXPORT_JOB_STATUS, exportJobEntity } from "../schema/export-job";

describe("EXPORT_JOB_STATUS Drift-Guard", () => {
  test("hat genau 4 Werte (pending/running/done/failed)", () => {
    const values = Object.values(EXPORT_JOB_STATUS);
    expect(values).toHaveLength(4);
    expect(values).toContain("pending");
    expect(values).toContain("running");
    expect(values).toContain("done");
    expect(values).toContain("failed");
  });

  test("Status-Strings sind lowercase + nur a-z (Convention-Check, keine Sortier-Aussage)", () => {
    // Test-Name ist bewusst praezise: wir checken Format, NICHT
    // alphabetische Sortierung — die State-Machine kuemmert sich nicht
    // um Sort-Order, ein Re-Order der Konstanten waere kein Bug.
    for (const value of Object.values(EXPORT_JOB_STATUS)) {
      expect(value).toBe(value.toLowerCase());
      expect(value).toMatch(/^[a-z]+$/);
    }
  });
});

describe("Export-TTL-Konstanten", () => {
  test("EXPORT_DOWNLOAD_TTL_DAYS > 0", () => {
    expect(EXPORT_DOWNLOAD_TTL_DAYS).toBeGreaterThan(0);
  });

  test("EXPORT_DOWNLOAD_TTL_DAYS <= 30 (DSGVO-Auskunftsfrist als sanity-cap)", () => {
    // Auskunftsfrist ist 30d — Download laenger zu halten als die
    // Antwort-Pflicht macht keinen Sinn (User sollte den Download
    // innerhalb der Frist abrufen).
    expect(EXPORT_DOWNLOAD_TTL_DAYS).toBeLessThanOrEqual(30);
  });

  test("EXPORT_STALE_TIMEOUT_MINUTES > 0", () => {
    expect(EXPORT_STALE_TIMEOUT_MINUTES).toBeGreaterThan(0);
  });

  test("EXPORT_STORAGE_CLEANUP_GRACE_HOURS > 0", () => {
    expect(EXPORT_STORAGE_CLEANUP_GRACE_HOURS).toBeGreaterThan(0);
  });
});

describe("exportJobEntity Schema-Shape", () => {
  test("hat alle Worker-relevanten Felder", () => {
    const fieldNames = Object.keys(exportJobEntity.fields);
    expect(fieldNames).toEqual(
      expect.arrayContaining([
        "userId",
        "status",
        "requestedAt",
        "startedAt",
        "completedAt",
        "downloadStorageKey",
        "expiresAt",
        "errorMessage",
        "bytesWritten",
      ]),
    );
  });

  test("Tabellen-Name ist read_export_jobs (snake_case-Convention)", () => {
    expect(exportJobEntity.table).toBe("read_export_jobs");
  });

  test("status-Default ist pending (neue Job-Rows starten dort)", () => {
    const statusField = exportJobEntity.fields["status"];
    expect(statusField).toBeDefined();
    if (statusField && "default" in statusField) {
      expect(statusField.default).toBe(EXPORT_JOB_STATUS.Pending);
    }
  });

  test("status-Optionen matchen die EXPORT_JOB_STATUS-Constants", () => {
    const statusField = exportJobEntity.fields["status"];
    if (statusField && "options" in statusField) {
      const options = (statusField as { options: readonly string[] }).options;
      expect([...options].sort()).toEqual(Object.values(EXPORT_JOB_STATUS).slice().sort());
    }
  });

  test("userId + status + requestedAt sind required", () => {
    expect(exportJobEntity.fields["userId"]?.required).toBe(true);
    expect(exportJobEntity.fields["status"]?.required).toBe(true);
    expect(exportJobEntity.fields["requestedAt"]?.required).toBe(true);
  });

  test("Lifecycle-Felder sind nullable (startedAt/completedAt/expiresAt/errorMessage/bytesWritten/downloadStorageKey)", () => {
    // Diese Felder werden vom Worker gesetzt, sind beim Insert null.
    // required ist undefined oder false — beides bedeutet nullable.
    expect(exportJobEntity.fields.startedAt.required).not.toBe(true);
    expect(exportJobEntity.fields.completedAt.required).not.toBe(true);
    expect(exportJobEntity.fields.expiresAt.required).not.toBe(true);
    expect(exportJobEntity.fields.errorMessage.required).not.toBe(true);
    expect(exportJobEntity.fields.bytesWritten.required).not.toBe(true);
    expect(exportJobEntity.fields.downloadStorageKey.required).not.toBe(true);
  });
});

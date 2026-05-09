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

import { COMPLIANCE_PROFILES } from "@cosmicdrift/kumiko-framework/compliance";
import { describe, expect, test } from "vitest";
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

describe("Export-Konfig in compliance-profiles", () => {
  // Atom 1c: TTL-Konstanten wandern aus user-data-rights/constants.ts
  // ins compliance-profile.userRights — pro Profile konfigurierbar +
  // per-Tenant-Override. Tests pinnen dass die Defaults pro Profile
  // sinnvoll sind.

  for (const profileKey of [
    "eu-dsgvo",
    "swiss-dsg",
    "de-hr-dsgvo-hgb",
    "minimal-no-region",
  ] as const) {
    test(`${profileKey}: exportDownloadTtl gesetzt + > 0`, () => {
      const profile = COMPLIANCE_PROFILES[profileKey];
      const ttl = profile.userRights.exportDownloadTtl;
      expect(ttl).toBeDefined();
      // DurationSpec hat entweder days oder hours.
      const hasDuration = ("days" in ttl && ttl.days > 0) || ("hours" in ttl && ttl.hours > 0);
      expect(hasDuration).toBe(true);
    });

    test(`${profileKey}: exportStaleTimeoutMinutes > 0`, () => {
      expect(COMPLIANCE_PROFILES[profileKey].userRights.exportStaleTimeoutMinutes).toBeGreaterThan(
        0,
      );
    });

    test(`${profileKey}: exportStorageCleanupGraceHours > 0`, () => {
      expect(
        COMPLIANCE_PROFILES[profileKey].userRights.exportStorageCleanupGraceHours,
      ).toBeGreaterThan(0);
    });
  }

  test("eu-dsgvo Default-TTL ist 7 Tage (sanity-Pin)", () => {
    expect(COMPLIANCE_PROFILES["eu-dsgvo"].userRights.exportDownloadTtl).toEqual({
      days: 7,
    });
  });

  test("Download-TTL <= 30d in jedem Profile (DSGVO-Auskunftsfrist als sanity-cap)", () => {
    // Auskunftsfrist ist 30d — Download laenger zu halten als die
    // Antwort-Pflicht macht keinen Sinn.
    for (const profileKey of [
      "eu-dsgvo",
      "swiss-dsg",
      "de-hr-dsgvo-hgb",
      "minimal-no-region",
    ] as const) {
      const ttl = COMPLIANCE_PROFILES[profileKey].userRights.exportDownloadTtl;
      const days = "days" in ttl ? ttl.days : Math.ceil(ttl.hours / 24);
      expect(days).toBeLessThanOrEqual(30);
    }
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

  test("bytesWritten ist bigInt-Field (NICHT number) — pinst Atom-1b-Migration", () => {
    // Drift-Guard: wenn jemand zurueck auf createNumberField refactored,
    // faellt der DB-Roundtrip-Test um (gut), aber das dauert >1s. Hier
    // <1s + klare Fehlermeldung was das Problem ist.
    expect(exportJobEntity.fields.bytesWritten.type).toBe("bigInt");
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

// Drift guard for the ExportJob schema.
//
// Ensures that:
//   - EXPORT_JOB_STATUS constants remain stable (the worker state machine
//     and UI polling read these values as magic strings, so any change
//     is a breaking change).
//   - Export constants have sensible values (TTL > 0, stale timeout
//     > 0, cleanup grace > 0).
//   - exportJobEntity has every field expected by the worker and handler —
//     if someone renames `expiresAt`, this test fails instead of the
//     worker failing first in production.
//
// Schema snapshot, not a behavior test. Behavior tests are covered separately.

import { describe, expect, test } from "bun:test";
import { COMPLIANCE_PROFILES } from "@cosmicdrift/kumiko-framework/compliance";
import { EXPORT_JOB_STATUS, exportJobEntity } from "../schema/export-job.ts";

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
    // The test name is intentionally precise: we check the format, NOT
    // alphabetical sorting — the state machine does not care about sort
    // order, so reordering the constants would not be a bug.
    for (const value of Object.values(EXPORT_JOB_STATUS)) {
      expect(value as string).toBe(value.toLowerCase());
      expect(value).toMatch(/^[a-z]+$/);
    }
  });
});

describe("Export-Konfig in compliance-profiles", () => {
  // TTL constants are configured in compliance-profile.userRights —
  // configurable per profile and overridable per tenant. Tests pin that
  // the defaults are sensible for each profile.

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
      // DurationSpec has either days or hours.
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
    // The access-request deadline is 30d — keeping the download longer
    // than the response obligation has no purpose.
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
        "requestedFromTenantId",
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
    // Drift guard: if someone refactors this back to createNumberField,
    // the database round-trip test will fail (which is useful), but it
    // takes >1s. This check takes <1s and gives a clear error message.
    expect(exportJobEntity.fields.bytesWritten.type).toBe("bigInt");
  });

  test("userId + requestedFromTenantId + status + requestedAt sind required", () => {
    expect(exportJobEntity.fields["userId"]?.required).toBe(true);
    // requestedFromTenantId is load-bearing: the worker reads it for
    // profile resolution. Without required, an insert without a value
    // would silently set NULL, and the worker would crash at
    // queryAs(systemUserOf(null), ...).
    expect(exportJobEntity.fields["requestedFromTenantId"]?.required).toBe(true);
    expect(exportJobEntity.fields["status"]?.required).toBe(true);
    expect(exportJobEntity.fields["requestedAt"]?.required).toBe(true);
  });

  test("Lifecycle-Felder sind nullable (startedAt/completedAt/expiresAt/errorMessage/bytesWritten/downloadStorageKey)", () => {
    // The worker sets these fields, so they are null on insert.
    // required being undefined or false means the field is nullable.
    expect(exportJobEntity.fields.startedAt.required).not.toBe(true);
    expect(exportJobEntity.fields.completedAt.required).not.toBe(true);
    expect(exportJobEntity.fields.expiresAt.required).not.toBe(true);
    expect(exportJobEntity.fields.errorMessage.required).not.toBe(true);
    expect(exportJobEntity.fields.bytesWritten.required).not.toBe(true);
    expect(exportJobEntity.fields.downloadStorageKey.required).not.toBe(true);
  });
});

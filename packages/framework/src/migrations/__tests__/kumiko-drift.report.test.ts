// Unit-Tests für formatKumikoDriftReport — per-cause Remediation.
// Regression für review #155 finding 2: vor dem Fix hat der Report immer den
// "kumiko schema apply"-Hint gezeigt, auch wenn das Problem ein checksum-
// mismatch war (den apply NICHT löst). Operator folgte der Anweisung und
// landete in einer Sackgasse.

import { describe, expect, test } from "bun:test";
import { formatKumikoDriftReport, type KumikoDriftReport } from "../kumiko-drift";

const empty: KumikoDriftReport = {
  ok: true,
  pending: [],
  checksumMismatches: [],
  missingTables: [],
  missingColumns: [],
};

describe("formatKumikoDriftReport", () => {
  test("ok report → short success line", () => {
    expect(formatKumikoDriftReport(empty)).toBe("Schema is current.");
  });

  test("pending only → recommends 'schema apply'", () => {
    const report: KumikoDriftReport = {
      ...empty,
      ok: false,
      pending: ["0001_init", "0002_add_locale"],
    };
    const out = formatKumikoDriftReport(report);
    expect(out).toContain("2 unapplied migration(s)");
    expect(out).toContain("0001_init");
    expect(out).toContain("Run 'kumiko schema apply'");
    expect(out).not.toContain("checksum");
    expect(out).not.toContain("dropped after apply");
  });

  test("checksum mismatch only → suggests revert/hand-correct, NOT 'schema apply'", () => {
    const report: KumikoDriftReport = {
      ...empty,
      ok: false,
      checksumMismatches: [
        { id: "0001_init", expected: "abcdef0123456789", actual: "fedcba9876543210" },
      ],
    };
    const out = formatKumikoDriftReport(report);
    expect(out).toContain("1 edited-after-apply");
    expect(out).toContain("Revert the edited migration");
    expect(out).toContain("cannot resolve a");
    expect(out).toContain("checksum mismatch");
    expect(out).not.toContain("Run 'kumiko schema apply'");
  });

  test("missing tables without pending → suggests backup/regen, NOT 'schema apply'", () => {
    const report: KumikoDriftReport = {
      ...empty,
      ok: false,
      missingTables: ["widget"],
    };
    const out = formatKumikoDriftReport(report);
    expect(out).toContain("1 missing table(s)");
    expect(out).toContain("dropped after apply");
    expect(out).toContain("Restore from backup");
    expect(out).not.toContain("Run 'kumiko schema apply'");
  });

  test("missing tables WITH pending → only the 'schema apply' hint (pending covers it)", () => {
    // Wenn pending da ist, applied das die noch fehlenden Tabellen → kein
    // Backup-Restore nötig. Verhindert verwirrenden Doppel-Hint.
    const report: KumikoDriftReport = {
      ...empty,
      ok: false,
      pending: ["0002_add_widget"],
      missingTables: ["widget"],
    };
    const out = formatKumikoDriftReport(report);
    expect(out).toContain("Run 'kumiko schema apply'");
    expect(out).not.toContain("Restore from backup");
  });

  test("missing columns → lists table.columns + regen remediation", () => {
    const report: KumikoDriftReport = {
      ...empty,
      ok: false,
      missingColumns: [{ table: "read_tenant_secrets", columns: ["envelope", "metadata"] }],
    };
    const out = formatKumikoDriftReport(report);
    expect(out).toContain("2 missing column(s)");
    expect(out).toContain("read_tenant_secrets: envelope, metadata");
    expect(out).toContain("'kumiko schema generate'");
  });

  test("pending + mismatch combined → both remediation lines", () => {
    const report: KumikoDriftReport = {
      ...empty,
      ok: false,
      pending: ["0002_add_locale"],
      checksumMismatches: [
        { id: "0001_init", expected: "abcdef0123456789", actual: "fedcba9876543210" },
      ],
    };
    const out = formatKumikoDriftReport(report);
    expect(out).toContain("Run 'kumiko schema apply'");
    expect(out).toContain("Revert the edited migration");
  });
});

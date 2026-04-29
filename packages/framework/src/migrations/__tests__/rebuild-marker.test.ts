// Unit-Tests für die Marker-File-IO. Production-Behavior:
//   - Generate-Step schreibt Marker mit kanonischer Struktur
//   - Apply-Step liest Marker zurück (oder null wenn keiner)
//   - schemaVersion-Mismatch wirft (verhindert dass alte Markers gegen
//     neue Lese-Logik fahren)

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readRebuildMarker, writeRebuildMarker } from "../rebuild-marker";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "kumiko-marker-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("writeRebuildMarker / readRebuildMarker round-trip", () => {
  test("schreibt File mit kanonischer Struktur", () => {
    writeRebuildMarker(tmpDir, "0042_brave_taskmaster", [
      "publicstatus:projection:incident-entity",
      "publicstatus:projection:component-entity",
    ]);
    const raw = readFileSync(join(tmpDir, "0042_brave_taskmaster__rebuild.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({
      schemaVersion: 1,
      migrationTag: "0042_brave_taskmaster",
      // sortiert — Reihenfolge der projections im Output ist deterministisch
      projections: [
        "publicstatus:projection:component-entity",
        "publicstatus:projection:incident-entity",
      ],
    });
  });

  test("read returns parsed marker", () => {
    writeRebuildMarker(tmpDir, "0001_foo", ["app:projection:bar-entity"]);
    const marker = readRebuildMarker(tmpDir, "0001_foo");
    expect(marker?.migrationTag).toBe("0001_foo");
    expect(marker?.projections).toEqual(["app:projection:bar-entity"]);
  });

  test("leere Projection-Liste schreibt KEIN File (Noise-Reduktion)", () => {
    writeRebuildMarker(tmpDir, "0003_only_index", []);
    expect(readRebuildMarker(tmpDir, "0003_only_index")).toBeNull();
  });

  test("read returns null wenn File nicht existiert", () => {
    expect(readRebuildMarker(tmpDir, "0099_never_written")).toBeNull();
  });

  test("schemaVersion-Mismatch wirft mit klarer Message", () => {
    const path = join(tmpDir, "0042_future__rebuild.json");
    writeFileSync(
      path,
      JSON.stringify({ schemaVersion: 999, migrationTag: "0042_future", projections: [] }),
    );
    expect(() => readRebuildMarker(tmpDir, "0042_future")).toThrow(/schemaVersion/);
  });

  test("korrupte JSON wirft (kein silent-null)", () => {
    const path = join(tmpDir, "0050_corrupt__rebuild.json");
    writeFileSync(path, "{ this is not json");
    expect(() => readRebuildMarker(tmpDir, "0050_corrupt")).toThrow();
  });

  test("Idempotenz: zweiter write überschreibt", () => {
    writeRebuildMarker(tmpDir, "0010_x", ["a:projection:one-entity"]);
    writeRebuildMarker(tmpDir, "0010_x", ["a:projection:two-entity"]);
    const marker = readRebuildMarker(tmpDir, "0010_x");
    expect(marker?.projections).toEqual(["a:projection:two-entity"]);
  });
});

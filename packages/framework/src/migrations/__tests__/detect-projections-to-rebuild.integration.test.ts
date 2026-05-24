// Integration-Test für detectProjectionsToRebuild — die Brücke zwischen
// Snapshot-Diff (Welle 2) und ImplicitProjection (Sprint G). Beweist dass
// `kumiko migrate generate` das richtige Marker-File schreibt: ein
// Spalten-Add auf einer r.entity-Tabelle muss als
// `<feature>:projection:<entity>-entity` rebuild-Kandidat erkannt werden.
//
// Production-Behavior: ohne diese Brücke würden die Welle-2- und
// Sprint-G-Pieces nebeneinander leben aber sich nicht treffen — Marker
// wäre leer, kein Rebuild würde ausgelöst.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createBooleanField, createEntity, createTextField, defineFeature } from "../../engine";
import { createRegistry } from "../../engine/registry";
import { detectProjectionsToRebuild } from "../projection-detection";

let migrationsDir: string;

beforeEach(() => {
  migrationsDir = mkdtempSync(join(tmpdir(), "kumiko-detect-"));
  mkdirSync(join(migrationsDir, "meta"), { recursive: true });
});

afterEach(() => {
  rmSync(migrationsDir, { recursive: true, force: true });
});

function writeJournal(entries: { idx: number; tag: string }[]): void {
  writeFileSync(
    join(migrationsDir, "meta/_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: entries.map((e) => ({
        idx: e.idx,
        version: "7",
        when: 1700000000000 + e.idx,
        tag: e.tag,
        breakpoints: true,
      })),
    }),
  );
}

function writeSnapshot(idx: number, tableName: string, columnNames: string[]): void {
  const columns: Record<string, unknown> = {};
  for (const name of columnNames) {
    columns[name] = { name, type: "text" };
  }
  // Plus base-columns die jede Entity-Tabelle hat, damit wir nicht mit
  // dem Test-Compare versehentlich kompletten neue Tabellen markieren.
  columns["id"] = { name: "id", type: "uuid", primaryKey: true, notNull: true };
  columns["tenant_id"] = { name: "tenant_id", type: "uuid", notNull: true };
  columns["version"] = { name: "version", type: "integer", default: 1, notNull: true };
  writeFileSync(
    join(migrationsDir, "meta", `${String(idx).padStart(4, "0")}_snapshot.json`),
    JSON.stringify({
      tables: {
        [`public.${tableName}`]: {
          schema: "",
          name: tableName,
          columns,
        },
      },
    }),
  );
}

const widgetEntity = createEntity({
  table: "test_widgets",
  fields: {
    name: createTextField({ required: true }),
    isEnabled: createBooleanField({ default: true }),
  },
});

const widgetFeature = defineFeature("detecttest", (r) => {
  r.entity("widget", widgetEntity);
});

describe("detectProjectionsToRebuild", () => {
  test("Spalten-Add auf r.entity-Tabelle → ImplicitProjection als Rebuild-Kandidat", () => {
    // Initial-Migration: 2 Spalten
    writeSnapshot(0, "test_widgets", ["name", "is_enabled"]);
    // Folge-Migration: 3 Spalten (description dazu)
    writeSnapshot(1, "test_widgets", ["name", "is_enabled", "description"]);
    writeJournal([
      { idx: 0, tag: "0000_init" },
      { idx: 1, tag: "0001_add_description" },
    ]);

    const registry = createRegistry([widgetFeature]);
    const projections = detectProjectionsToRebuild(registry, migrationsDir);

    expect(projections).toEqual(["detecttest:projection:widget-entity"]);
  });

  test("identische Snapshots → keine Rebuild-Kandidaten", () => {
    writeSnapshot(0, "test_widgets", ["name", "is_enabled"]);
    writeSnapshot(1, "test_widgets", ["name", "is_enabled"]);
    writeJournal([
      { idx: 0, tag: "0000_init" },
      { idx: 1, tag: "0001_no_op" },
    ]);

    const registry = createRegistry([widgetFeature]);
    expect(detectProjectionsToRebuild(registry, migrationsDir)).toEqual([]);
  });

  test("Initial-Migration (nur ein Snapshot) → leer (keine historischen Events)", () => {
    writeSnapshot(0, "test_widgets", ["name"]);
    writeJournal([{ idx: 0, tag: "0000_init" }]);

    const registry = createRegistry([widgetFeature]);
    expect(detectProjectionsToRebuild(registry, migrationsDir)).toEqual([]);
  });

  test("Spalten-Add auf einer Tabelle die KEINE Projection ist → leer", () => {
    // Tabelle "unrelated" ist nicht als Projection registriert (kein
    // r.entity, keine r.projection). Schema-Change soll keinen
    // Rebuild-Marker erzeugen.
    writeSnapshot(0, "unrelated", ["a"]);
    writeSnapshot(1, "unrelated", ["a", "b"]);
    writeJournal([
      { idx: 0, tag: "0000_init" },
      { idx: 1, tag: "0001_add_b" },
    ]);

    const registry = createRegistry([widgetFeature]);
    expect(detectProjectionsToRebuild(registry, migrationsDir)).toEqual([]);
  });
});

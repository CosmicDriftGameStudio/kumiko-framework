import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EntityTableMeta } from "../entity-table-meta";
import { diffSnapshots, snapshotFromMetas } from "../migrate-generator";
import { readRebuildMarker, rebuildTablesFromDiff, writeRebuildMarker } from "../rebuild-marker";

function meta(
  tableName: string,
  extraColumn?: EntityTableMeta["columns"][number],
  indexes: EntityTableMeta["indexes"] = [],
): EntityTableMeta {
  return {
    tableName,
    source: "unmanaged",
    indexes,
    columns: [
      { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
      ...(extraColumn ? [extraColumn] : []),
    ],
  };
}

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "rebuild-marker-"));
}

describe("rebuildTablesFromDiff", () => {
  test("includes new + changed tables, excludes dropped, sorted + unique", () => {
    const prev = snapshotFromMetas([meta("read_a"), meta("read_c")]);
    const next = snapshotFromMetas([
      meta("read_a", { name: "title", pgType: "text", notNull: true }),
      meta("read_b"),
    ]);
    const diff = diffSnapshots(prev, next);
    expect(rebuildTablesFromDiff(diff)).toEqual(["read_a", "read_b"]);
  });

  test("no schema change → empty", () => {
    const snap = snapshotFromMetas([meta("read_a")]);
    expect(rebuildTablesFromDiff(diffSnapshots(snap, snap))).toEqual([]);
  });

  test("index-only change → no rebuild (ALTER bringt Tabelle alleine in Soll)", () => {
    const prev = snapshotFromMetas([meta("read_a")]);
    const next = snapshotFromMetas([
      meta("read_a", undefined, [{ name: "read_a_id_idx", columns: ["id"] }]),
    ]);
    expect(rebuildTablesFromDiff(diffSnapshots(prev, next))).toEqual([]);
  });

  test("dropped-column-only change → no rebuild", () => {
    const prev = snapshotFromMetas([
      meta("read_a", { name: "old", pgType: "text", notNull: false }),
    ]);
    const next = snapshotFromMetas([meta("read_a")]);
    expect(rebuildTablesFromDiff(diffSnapshots(prev, next))).toEqual([]);
  });

  test("new-column change → rebuild (Backfill aus Events nötig)", () => {
    const prev = snapshotFromMetas([meta("read_a")]);
    const next = snapshotFromMetas([
      meta("read_a", { name: "title", pgType: "text", notNull: false }),
    ]);
    expect(rebuildTablesFromDiff(diffSnapshots(prev, next))).toEqual(["read_a"]);
  });
});

describe("write/read marker", () => {
  test("roundtrip: write tables → read them back via migration-id", () => {
    const dir = tmpDir();
    try {
      writeRebuildMarker(dir, "0002_add_locale.sql", ["read_users", "read_text_blocks"]);
      expect(existsSync(join(dir, "0002_add_locale.rebuild.json"))).toBe(true);
      expect(readRebuildMarker(dir, "0002_add_locale")).toEqual(["read_users", "read_text_blocks"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("empty table list → no marker file written, read returns []", () => {
    const dir = tmpDir();
    try {
      writeRebuildMarker(dir, "0003_noop.sql", []);
      expect(existsSync(join(dir, "0003_noop.rebuild.json"))).toBe(false);
      expect(readRebuildMarker(dir, "0003_noop")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("missing marker → []", () => {
    const dir = tmpDir();
    try {
      expect(readRebuildMarker(dir, "9999_absent")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("corrupt marker file → [] (does not throw)", () => {
    const dir = tmpDir();
    try {
      writeFileSync(join(dir, "0004_broken.rebuild.json"), "{ not json");
      expect(readRebuildMarker(dir, "0004_broken")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("version-mismatch marker → [] (graceful degradation, blockt v2 nicht als v1)", () => {
    const dir = tmpDir();
    try {
      writeFileSync(
        join(dir, "0005_future.rebuild.json"),
        JSON.stringify({ version: 2, tables: ["read_x"] }),
      );
      expect(readRebuildMarker(dir, "0005_future")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("missing version field → []", () => {
    const dir = tmpDir();
    try {
      writeFileSync(join(dir, "0006_noversion.rebuild.json"), JSON.stringify({ tables: ["x"] }));
      expect(readRebuildMarker(dir, "0006_noversion")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

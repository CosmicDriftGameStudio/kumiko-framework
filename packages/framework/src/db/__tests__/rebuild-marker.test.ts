import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEntity, createImagesField, createTextField } from "../../engine/index.ts";
import { deriveEntityTableMeta, type EntityTableMeta } from "../entity-table-meta.ts";
import { diffSnapshots, renderMigrationSql, snapshotFromMetas } from "../migrate-generator.ts";
import { readRebuildMarker, rebuildTablesFromDiff, writeRebuildMarker } from "../rebuild-marker.ts";

function meta(
  tableName: string,
  extraColumn?: EntityTableMeta["columns"][number],
  indexes: EntityTableMeta["indexes"] = [],
  source: EntityTableMeta["source"] = "managed",
): EntityTableMeta {
  return {
    tableName,
    source,
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
  test("managed: new table rebuilt, additive-only change NOT rebuilt, dropped excluded", () => {
    // read_a: only a nullable column added → in-place ALTER, no rebuild.
    // read_b: new table → rebuild. read_c dropped → never included in the marker.
    const prev = snapshotFromMetas([meta("read_a"), meta("read_c")]);
    const next = snapshotFromMetas([
      meta("read_a", { name: "title", pgType: "text", notNull: false }),
      meta("read_b"),
    ]);
    const diff = diffSnapshots(prev, next);
    expect(rebuildTablesFromDiff(diff)).toEqual(["read_b"]);
  });

  test("managed new _bidx column → rebuild (blind index needs plaintext HMAC, SQL can't backfill)", () => {
    const prev = snapshotFromMetas([meta("read_a")]);
    const next = snapshotFromMetas([
      meta("read_a", { name: "invited_by_bidx", pgType: "text", notNull: false }),
    ]);
    expect(rebuildTablesFromDiff(diffSnapshots(prev, next))).toEqual(["read_a"]);
  });

  test("no schema change → empty", () => {
    const snap = snapshotFromMetas([meta("read_a")]);
    expect(rebuildTablesFromDiff(diffSnapshots(snap, snap))).toEqual([]);
  });

  test("managed non-unique index-only change → no rebuild (ALTER alone puts the table in the desired state)", () => {
    const prev = snapshotFromMetas([meta("read_a")]);
    const next = snapshotFromMetas([
      meta("read_a", undefined, [{ name: "read_a_id_idx", columns: ["id"] }]),
    ]);
    expect(rebuildTablesFromDiff(diffSnapshots(prev, next))).toEqual([]);
  });

  test("managed new NULLABLE column → NO rebuild (in-place ADD COLUMN is sufficient; Rebuild would wipe the column)", () => {
    const prev = snapshotFromMetas([meta("read_a")]);
    const next = snapshotFromMetas([
      meta("read_a", { name: "title", pgType: "text", notNull: false }),
    ]);
    expect(rebuildTablesFromDiff(diffSnapshots(prev, next))).toEqual([]);
  });

  test("managed new NOT-NULL column without a default → rebuild (recreate, cannot be done in-place)", () => {
    const prev = snapshotFromMetas([meta("read_a")]);
    const next = snapshotFromMetas([
      meta("read_a", { name: "title", pgType: "text", notNull: true }),
    ]);
    expect(rebuildTablesFromDiff(diffSnapshots(prev, next))).toEqual(["read_a"]);
  });

  test("managed dropped column → rebuild (table is DROP+CREATE'd, refill)", () => {
    const prev = snapshotFromMetas([
      meta("read_a", { name: "old", pgType: "text", notNull: false }),
    ]);
    const next = snapshotFromMetas([meta("read_a")]);
    expect(rebuildTablesFromDiff(diffSnapshots(prev, next))).toEqual(["read_a"]);
  });

  test("managed SET NOT NULL → rebuild (recreate)", () => {
    const prev = snapshotFromMetas([
      meta("read_a", { name: "title", pgType: "text", notNull: false }),
    ]);
    const next = snapshotFromMetas([
      meta("read_a", { name: "title", pgType: "text", notNull: true }),
    ]);
    expect(rebuildTablesFromDiff(diffSnapshots(prev, next))).toEqual(["read_a"]);
  });

  test("managed new UNIQUE index → rebuild (recreate, could fail on duplicates)", () => {
    const prev = snapshotFromMetas([meta("read_a")]);
    const next = snapshotFromMetas([
      meta("read_a", undefined, [{ name: "read_a_id_uq", columns: ["id"], unique: true }]),
    ]);
    expect(rebuildTablesFromDiff(diffSnapshots(prev, next))).toEqual(["read_a"]);
  });

  test("unmanaged tables are never rebuilt (real data, not a projection)", () => {
    const prev = snapshotFromMetas([meta("u_a", undefined, [], "unmanaged")]);
    const next = snapshotFromMetas([
      meta("u_a", { name: "title", pgType: "text", notNull: true }, [], "unmanaged"),
      meta("u_new", undefined, [], "unmanaged"),
    ]);
    expect(rebuildTablesFromDiff(diffSnapshots(prev, next))).toEqual([]);
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

  test("version-mismatch marker → [] (graceful degradation, does not treat v2 as v1)", () => {
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

describe("plural file field added to an existing managed entity", () => {
  const textField = createTextField({ personal: false, reason: "test_fixture" });
  const before = createEntity({ table: "albums", fields: { title: textField } });
  const after = createEntity({
    table: "albums",
    fields: { title: textField, photos: createImagesField() },
  });

  test("is an in-place ADD COLUMN with a '[]' default and no rebuild marker", () => {
    const diff = diffSnapshots(
      snapshotFromMetas([deriveEntityTableMeta("albums", before)]),
      snapshotFromMetas([deriveEntityTableMeta("albums", after)]),
    );

    expect(rebuildTablesFromDiff(diff)).toEqual([]);
    const sql = renderMigrationSql(diff, { name: "add_photos", sequenceNumber: 1 });
    expect(sql).toContain(
      `ALTER TABLE "albums" ADD COLUMN "photos" jsonb DEFAULT '[]'::jsonb NOT NULL;`,
    );
    expect(sql).not.toContain("DROP TABLE");
  });
});

// #1210: deriveEntityTableMeta() hardcoded source: "managed", so unmanaged
// direct-write stores (store_user_sessions, store_api_tokens, mail sync/seen
// cursors) were misclassified as rebuildable event-sourced projections — a
// destructive column change would DROP+rebuild-from-events tables that have
// no events, wiping live data. The options.source escape hatch must produce
// a byte-identical column/piiSubjectFields shape (only source differs), so
// the migration diff for an existing table stays empty when flipping it.

import { describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "../../engine";
import { defineUnmanagedTable, deriveEntityTableMeta } from "../entity-table-meta";
import { diffSnapshots, snapshotFromMetas } from "../migrate-generator";

const entity = createEntity({
  table: "source-probe",
  fields: {
    userId: createTextField({ required: true }),
    ip: createTextField({ userOwned: { ownerField: "userId" } }),
  },
});

describe("deriveEntityTableMeta — options.source (#1210)", () => {
  test("defaults to managed when omitted", () => {
    expect(deriveEntityTableMeta("source-probe", entity).source).toBe("managed");
  });

  test("options.source: 'unmanaged' changes only source, columns + piiSubjectFields stay identical", () => {
    const managed = deriveEntityTableMeta("source-probe", entity);
    const unmanaged = deriveEntityTableMeta("source-probe", entity, { source: "unmanaged" });

    expect(managed.source).toBe("managed");
    expect(unmanaged.source).toBe("unmanaged");
    expect(unmanaged.columns).toEqual(managed.columns);
    expect(unmanaged.indexes).toEqual(managed.indexes);
    expect(unmanaged.piiSubjectFields).toEqual(managed.piiSubjectFields);
    expect(unmanaged.piiSubjectFields).toEqual(["ip"]);
  });

  test("flipping an existing table's meta to unmanaged produces an empty migration diff", () => {
    const prevSnapshot = snapshotFromMetas([deriveEntityTableMeta("source-probe", entity)]);
    const nextSnapshot = snapshotFromMetas([
      deriveEntityTableMeta("source-probe", entity, { source: "unmanaged" }),
    ]);

    const diff = diffSnapshots(prevSnapshot, nextSnapshot);
    expect(diff.newTables).toEqual([]);
    expect(diff.droppedTables).toEqual([]);
    expect(diff.changedTables).toEqual([]);
  });

  test("deprecated buildEntityTableMeta alias still works", async () => {
    const { buildEntityTableMeta } = await import("../entity-table-meta");
    expect(buildEntityTableMeta("source-probe", entity).source).toBe("managed");
  });
});

describe("unmanaged builders reject read_ prefix (#1208)", () => {
  test("deriveEntityTableMeta(..., { source: unmanaged }) with read_ table throws", () => {
    const readEntity = createEntity({
      table: "read_source_probe",
      fields: { userId: createTextField({ required: true }) },
    });
    expect(() =>
      deriveEntityTableMeta("source-probe", readEntity, { source: "unmanaged" }),
    ).toThrow(/the "read_" prefix is reserved/);
  });

  test("default toTableName (read_*) + unmanaged throws", () => {
    const noTable = createEntity({
      fields: { userId: createTextField({ required: true }) },
    });
    expect(() => deriveEntityTableMeta("source-probe", noTable, { source: "unmanaged" })).toThrow(
      /the "read_" prefix is reserved/,
    );
  });

  test("defineUnmanagedTable with read_ tableName throws", () => {
    expect(() =>
      defineUnmanagedTable({
        tableName: "read_oops",
        columns: [{ name: "id", pgType: "text", notNull: true, primaryKey: true }],
      }),
    ).toThrow(/the "read_" prefix is reserved/);
  });
});

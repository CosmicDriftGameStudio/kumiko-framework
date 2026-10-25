// deriveEntityTableMeta() hardcoded source: "managed", so unmanaged
// direct-write stores (store_user_sessions, store_api_tokens, mail sync/seen
// cursors) were misclassified as rebuildable event-sourced projections — a
// destructive column change would DROP+rebuild-from-events tables that have
// no events, wiping live data. The options.source escape hatch must produce
// a byte-identical column/piiSubjectFields shape (only source differs), so
// the migration diff for an existing table stays empty when flipping it.

import { describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "../../engine/index.ts";
import { defineUnmanagedTable, deriveEntityTableMeta } from "../entity-table-meta.ts";
import { diffSnapshots, snapshotFromMetas } from "../migrate-generator.ts";

const entity = createEntity({
  table: "source-probe",
  fields: {
    userId: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    ip: createTextField({
      personal: { of: "userId" },
      find: "none",
    }),
  },
});

describe("deriveEntityTableMeta — options.source", () => {
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
});

describe("unmanaged builders reject read_ prefix", () => {
  test("deriveEntityTableMeta(..., { source: unmanaged }) with read_ table throws", () => {
    const readEntity = createEntity({
      table: "read_source_probe",
      fields: {
        userId: createTextField({ required: true, personal: false, reason: "test_fixture" }),
      },
    });
    expect(() =>
      deriveEntityTableMeta("source-probe", readEntity, { source: "unmanaged" }),
    ).toThrow(/the "read_" prefix is reserved/);
  });

  test("default toTableName (read_*) + unmanaged throws", () => {
    const noTable = createEntity({
      fields: {
        userId: createTextField({ required: true, personal: false, reason: "test_fixture" }),
      },
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

describe("deriveEntityTableMeta — recordOwned on a serial unmanaged store", () => {
  const serialEntity = createEntity({
    table: "store_serial_record_owned",
    idType: "serial",
    fields: { body: createTextField({ personal: { of: "id" }, find: "none" }) },
  });

  test("unmanaged + idType serial + recordOwned field throws, naming entity and field", () => {
    expect(() => deriveEntityTableMeta("x", serialEntity, { source: "unmanaged" })).toThrow(
      /"x".*"body".*recordOwned/,
    );
  });

  test('unmanaged + idType serial + whenAbsent "self" field throws — it keys ownerless rows on the record', () => {
    const selfEntity = createEntity({
      table: "store_serial_when_absent_self",
      idType: "serial",
      fields: {
        ownerId: createTextField({ personal: "ref" }),
        body: createTextField({ personal: { of: "ownerId", whenAbsent: "self" }, find: "none" }),
      },
    });
    expect(() => deriveEntityTableMeta("x", selfEntity, { source: "unmanaged" })).toThrow(
      /"x".*"body".*whenAbsent: "self"/,
    );
  });

  test("the same entity with a uuid id derives fine", () => {
    const uuidEntity = createEntity({
      table: "store_uuid_record_owned",
      fields: { body: createTextField({ personal: { of: "id" }, find: "none" }) },
    });
    expect(() => deriveEntityTableMeta("x", uuidEntity, { source: "unmanaged" })).not.toThrow();
  });
});

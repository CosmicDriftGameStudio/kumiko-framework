// #1210: buildEntityTableMeta() hardcoded source: "managed", so unmanaged
// direct-write stores (store_user_sessions, store_api_tokens, mail sync/seen
// cursors) were misclassified as rebuildable event-sourced projections — a
// destructive column change would DROP+rebuild-from-events tables that have
// no events, wiping live data. The options.source escape hatch must produce
// a byte-identical column/piiSubjectFields shape (only source differs), so
// the migration diff for an existing table stays empty when flipping it.

import { describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "../../engine";
import { buildEntityTableMeta } from "../entity-table-meta";
import { diffSnapshots, snapshotFromMetas } from "../migrate-generator";

const entity = createEntity({
  table: "source-probe",
  fields: {
    userId: createTextField({ required: true }),
    ip: createTextField({ userOwned: { ownerField: "userId" } }),
  },
});

describe("buildEntityTableMeta — options.source (#1210)", () => {
  test("defaults to managed when omitted", () => {
    expect(buildEntityTableMeta("source-probe", entity).source).toBe("managed");
  });

  test("options.source: 'unmanaged' changes only source, columns + piiSubjectFields stay identical", () => {
    const managed = buildEntityTableMeta("source-probe", entity);
    const unmanaged = buildEntityTableMeta("source-probe", entity, { source: "unmanaged" });

    expect(managed.source).toBe("managed");
    expect(unmanaged.source).toBe("unmanaged");
    expect(unmanaged.columns).toEqual(managed.columns);
    expect(unmanaged.indexes).toEqual(managed.indexes);
    expect(unmanaged.piiSubjectFields).toEqual(managed.piiSubjectFields);
    expect(unmanaged.piiSubjectFields).toEqual(["ip"]);
  });

  test("flipping an existing table's meta to unmanaged produces an empty migration diff", () => {
    const prevSnapshot = snapshotFromMetas([buildEntityTableMeta("source-probe", entity)]);
    const nextSnapshot = snapshotFromMetas([
      buildEntityTableMeta("source-probe", entity, { source: "unmanaged" }),
    ]);

    const diff = diffSnapshots(prevSnapshot, nextSnapshot);
    expect(diff.newTables).toEqual([]);
    expect(diff.droppedTables).toEqual([]);
    expect(diff.changedTables).toEqual([]);
  });
});

// Regression test for #255-class drift: storeTables must appear in
// enumerateFeatureTableSources so setupTestStack's auto-push and
// collectTableMetas see the exact same table set. Before this fix,
// unmanaged tables were only handled by collectTableMetas directly, so any
// app relying on setupTestStack's ephemeral DB (Playwright/e2e) never got
// its store tables created — e.g. the bundled "sessions" feature's
// store_user_sessions, breaking every login in an ephemeral test stack.

import { describe, expect, test } from "bun:test";
import { defineFeature } from "../../engine/define-feature";
import { defineUnmanagedTable } from "../entity-table-meta";
import { enumerateFeatureTableSources } from "../feature-table-sources";

const probeMeta = defineUnmanagedTable({
  tableName: "ftst_probe",
  columns: [{ name: "id", pgType: "text", notNull: true, primaryKey: true }],
});

describe("enumerateFeatureTableSources — storeTables", () => {
  test("includes a feature's storeTable as a table source", () => {
    const feature = defineFeature("probe", (r) => {
      r.storeTable(probeMeta, { reason: "direct-write store" });
    });
    const sources = enumerateFeatureTableSources(feature);
    const entry = sources.find((s) => s.origin.includes("ftst_probe"));
    expect(entry).toBeDefined();
    expect(entry?.table).toBe(probeMeta);
  });

  test("a feature with no storeTable contributes nothing extra", () => {
    const feature = defineFeature("plain", () => {});
    expect(enumerateFeatureTableSources(feature)).toEqual([]);
  });
});

// Regression test for #255-class drift: unmanagedTables must appear in
// enumerateFeatureTableSources so setupTestStack's auto-push and
// collectTableMetas see the exact same table set. Before this fix,
// unmanagedTables were only handled by collectTableMetas directly, so any
// app relying on setupTestStack's ephemeral DB (Playwright/e2e) never got
// its unmanaged tables created — e.g. the bundled "sessions" feature's
// read_user_sessions, breaking every login in an ephemeral test stack.

import { describe, expect, test } from "bun:test";
import { defineFeature } from "../../engine/define-feature";
import { defineUnmanagedTable } from "../entity-table-meta";
import { enumerateFeatureTableSources } from "../feature-table-sources";

const probeMeta = defineUnmanagedTable({
  tableName: "ftst_probe",
  columns: [{ name: "id", pgType: "text", notNull: true, primaryKey: true }],
});

describe("enumerateFeatureTableSources — unmanagedTables", () => {
  test("includes a feature's unmanagedTable as a table source", () => {
    const feature = defineFeature("probe", (r) => {
      r.unmanagedTable(probeMeta, { reason: "direct-write store" });
    });
    const sources = enumerateFeatureTableSources(feature);
    const entry = sources.find((s) => s.origin.includes("ftst_probe"));
    expect(entry).toBeDefined();
    expect(entry?.table).toBe(probeMeta);
  });

  test("a feature with no unmanagedTable contributes nothing extra", () => {
    const feature = defineFeature("plain", () => {});
    expect(enumerateFeatureTableSources(feature)).toEqual([]);
  });
});

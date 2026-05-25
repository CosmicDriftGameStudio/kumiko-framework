// Unit tests for r.unmanagedTable() — the EntityTableMeta cousin of
// r.rawTable. Same audit-trail contract, different storage shape (post-
// drizzle migrate-runner). See define-feature.ts / DX-4.

import { describe, expect, test } from "bun:test";
import { defineUnmanagedTable } from "../../db/entity-table-meta";
import { defineFeature } from "../define-feature";
import { createRegistry } from "../registry";

const probeMeta = defineUnmanagedTable({
  tableName: "ut_probe",
  columns: [{ name: "id", pgType: "text", notNull: true, primaryKey: true }],
});
const probeMetaTwo = defineUnmanagedTable({
  tableName: "ut_probe_two",
  columns: [{ name: "id", pgType: "text", notNull: true, primaryKey: true }],
});

describe("r.unmanagedTable — declaration", () => {
  test("rejects duplicate registrations within one feature", () => {
    expect(() =>
      defineFeature("probe", (r) => {
        r.unmanagedTable(probeMeta, { reason: "test" });
        r.unmanagedTable(probeMeta, { reason: "test" });
      }),
    ).toThrow(/already registered/);
  });

  test("rejects empty reason", () => {
    expect(() =>
      defineFeature("probe", (r) => {
        r.unmanagedTable(probeMeta, { reason: "" });
      }),
    ).toThrow(/options\.reason must be a non-empty string/);
  });

  test("rejects whitespace-only reason", () => {
    expect(() =>
      defineFeature("probe", (r) => {
        r.unmanagedTable(probeMeta, { reason: "   " });
      }),
    ).toThrow(/options\.reason must be a non-empty string/);
  });

  test("accepts valid registration and stores meta + reason", () => {
    const feature = defineFeature("probe", (r) => {
      r.unmanagedTable(probeMeta, {
        reason: "read-side projection of an event-stream",
      });
    });
    expect(feature.unmanagedTables).toHaveProperty("ut_probe");
    expect(feature.unmanagedTables["ut_probe"]?.reason).toBe(
      "read-side projection of an event-stream",
    );
    expect(feature.unmanagedTables["ut_probe"]?.meta).toBe(probeMeta);
  });

  test("two unmanaged tables on one feature register under their tableName", () => {
    const feature = defineFeature("dual", (r) => {
      r.unmanagedTable(probeMeta, { reason: "one" });
      r.unmanagedTable(probeMetaTwo, { reason: "two" });
    });
    expect(Object.keys(feature.unmanagedTables).sort()).toEqual(["ut_probe", "ut_probe_two"]);
  });

  test("absent unmanagedTables on a feature is ok", () => {
    const feat = defineFeature("plain", () => {
      // no r.unmanagedTable calls
    });
    expect(feat.unmanagedTables).toEqual({});
  });
});

describe("createRegistry — unmanagedTable aggregation", () => {
  test("rejects cross-feature tableName collisions at boot", () => {
    // Two features can't share the same physical tableName — migrate-runner
    // would race two CREATE TABLE statements. Boot-validator catches it.
    const featA = defineFeature("a", (r) => {
      r.unmanagedTable(probeMeta, { reason: "first" });
    });
    const featB = defineFeature("b", (r) => {
      r.unmanagedTable(probeMeta, { reason: "second" });
    });
    expect(() => createRegistry([featA, featB])).toThrow(
      /Unmanaged-table "ut_probe" registered by both feature "a" and "b"/,
    );
  });

  test("two features with distinct tableNames register cleanly", () => {
    const featA = defineFeature("a", (r) => {
      r.unmanagedTable(probeMeta, { reason: "first" });
    });
    const featB = defineFeature("b", (r) => {
      r.unmanagedTable(probeMetaTwo, { reason: "second" });
    });
    expect(() => createRegistry([featA, featB])).not.toThrow();
  });
});

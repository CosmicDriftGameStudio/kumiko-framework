// kumiko-framework#1475: globalFeatureStateTable's columns are declared
// twice by hand — once as a Drizzle-style pgTable (table()), for the
// query API, once as globalFeatureStateTableMeta (defineUnmanagedTable),
// for the migration-generator's DDL diff. Nothing wires these together —
// asEntityTableMeta(globalFeatureStateTable) would already derive an
// equivalent EntityTableMeta from the pgTable definition, but this file
// doesn't use it. Someone adding a column only to the pgTable (so queries
// against it type-check) would leave the migration generator blind to it:
// no migration ever gets written, and the first insertOne/updateMany that
// touches the new column fails in prod with "column ... does not exist",
// while every test using the in-memory/mocked stack stays green.
//
// This test doesn't change which meta ships to the migration generator
// (deriving it live from the pgTable is a separate, higher-risk change
// on a table that already has committed migrations) — it just pins that
// the two hand-written declarations stay in lockstep, so that drift fails
// loudly here instead of silently in a real deploy.

import { describe, expect, test } from "bun:test";
import { asEntityTableMeta } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  globalFeatureStateTable,
  globalFeatureStateTableMeta,
} from "../global-feature-state-table";

describe("globalFeatureStateTableMeta stays in sync with the pgTable definition", () => {
  test("column names, pgTypes and notNull match the pgTable's derived meta", () => {
    const derived = asEntityTableMeta(globalFeatureStateTable);
    expect(derived).toBeDefined();

    const derivedColumns = new Map((derived?.columns ?? []).map((c) => [c.name, c]));
    const handColumns = new Map(globalFeatureStateTableMeta.columns.map((c) => [c.name, c]));

    expect([...handColumns.keys()].sort()).toEqual([...derivedColumns.keys()].sort());

    for (const [name, handCol] of handColumns) {
      const derivedCol = derivedColumns.get(name);
      expect(derivedCol, `column "${name}" missing from the pgTable-derived meta`).toBeDefined();
      expect(derivedCol?.pgType, `column "${name}" pgType drift`).toBe(handCol.pgType);
      expect(derivedCol?.notNull, `column "${name}" notNull drift`).toBe(handCol.notNull);
    }
  });

  test("tableName matches", () => {
    const derived = asEntityTableMeta(globalFeatureStateTable);
    expect(derived?.tableName).toBe(globalFeatureStateTableMeta.tableName);
  });
});

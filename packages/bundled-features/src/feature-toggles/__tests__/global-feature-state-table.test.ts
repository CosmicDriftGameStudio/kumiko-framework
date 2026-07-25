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
  // Full-column equality, not a per-field pick — `primaryKey`/`defaultSql`
  // are exactly what the migration-generator's DDL comes from, and a
  // field-by-field compare that only checked pgType/notNull silently missed
  // drift there (e.g. dropping `.default(sql\`now()\`)` or a PK change on
  // the pgTable would previously go undetected).
  test("columns match the pgTable's derived meta exactly", () => {
    const derived = asEntityTableMeta(globalFeatureStateTable);
    expect(derived).toBeDefined();
    expect(derived?.columns).toEqual(globalFeatureStateTableMeta.columns);
  });

  test("tableName matches", () => {
    const derived = asEntityTableMeta(globalFeatureStateTable);
    expect(derived?.tableName).toBe(globalFeatureStateTableMeta.tableName);
  });
});

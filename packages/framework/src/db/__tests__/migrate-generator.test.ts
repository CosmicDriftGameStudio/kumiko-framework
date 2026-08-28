import { describe, expect, test } from "bun:test";
import type { EntityTableMeta, IndexMeta } from "../entity-table-meta";
import {
  assertValidMigrationName,
  diffSnapshots,
  generateMigration,
  renderMigrationSql,
  snapshotFromMetas,
} from "../migrate-generator";

function meta(
  tableName: string,
  extraColumn?: EntityTableMeta["columns"][number],
  source: EntityTableMeta["source"] = "unmanaged",
): EntityTableMeta {
  return {
    tableName,
    source,
    indexes: [],
    columns: [
      { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
      ...(extraColumn ? [extraColumn] : []),
    ],
  };
}

function metaWithIndexes(
  tableName: string,
  indexes: readonly IndexMeta[],
  source: EntityTableMeta["source"] = "unmanaged",
): EntityTableMeta {
  return {
    tableName,
    source,
    indexes,
    columns: [{ name: "id", pgType: "uuid", notNull: true, primaryKey: true }],
  };
}

describe("snapshotFromMetas", () => {
  test("sorts tables by name for stable snapshots", () => {
    const snap = snapshotFromMetas([meta("zebras"), meta("apples")]);
    expect(snap.tables.map((t) => t.tableName)).toEqual(["apples", "zebras"]);
    expect(snap.version).toBe(1);
  });

  test("sorts by codepoint, not locale — deterministic across ICU locales (#367)", () => {
    // localeCompare orders case-insensitively ("apple" < "Zebra"); codepoint
    // puts uppercase (U+005A) before lowercase (U+0061) → "Zebra" < "apple".
    // The snapshot JSON is byte-compared and the order carries into the
    // generated migration SQL, so a revert to localeCompare would reorder the
    // committed bytes depending on the runner's ICU locale. Fails the moment
    // anyone swaps compareByCodepoint back to localeCompare.
    const snap = snapshotFromMetas([meta("apple"), meta("Zebra")]);
    expect(snap.tables.map((t) => t.tableName)).toEqual(["Zebra", "apple"]);
  });
});

describe("diffSnapshots", () => {
  test("null prev → all tables are new", () => {
    const next = snapshotFromMetas([meta("tasks")]);
    const diff = diffSnapshots(null, next);
    expect(diff.newTables.map((t) => t.tableName)).toEqual(["tasks"]);
    expect(diff.droppedTables).toEqual([]);
  });

  test("detects dropped table and new column", () => {
    const prev = snapshotFromMetas([meta("tasks"), meta("legacy")]);
    const next = snapshotFromMetas([
      meta("tasks", { name: "title", pgType: "text", notNull: true }),
    ]);
    const diff = diffSnapshots(prev, next);
    expect(diff.droppedTables).toEqual(["legacy"]);
    expect(diff.changedTables[0]?.newColumns.map((c) => c.name)).toEqual(["title"]);
  });
});

describe("renderMigrationSql / generateMigration", () => {
  test("emits CREATE TABLE for new tables", () => {
    const diff = diffSnapshots(null, snapshotFromMetas([meta("tasks")]));
    const sql = renderMigrationSql(diff, { name: "init", sequenceNumber: 1 });
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "tasks"');
    expect(sql).toContain("Migration 0001_init");
  });

  test("generateMigration bundles snapshot + sql", () => {
    const out = generateMigration({
      metas: [meta("tasks")],
      prevSnapshot: null,
      name: "init",
      sequenceNumber: 1,
    });
    expect(out.snapshot.tables).toHaveLength(1);
    expect(out.sqlContent).toContain("0001_init");
    expect(out.filename).toBe("0001_init.sql");
  });
});

describe("renderMigrationSql — managed recreate vs unmanaged in-place", () => {
  test("managed: NOT NULL column without default → DROP+CREATE, no in-place ADD", () => {
    const prev = snapshotFromMetas([meta("read_secrets", undefined, "managed")]);
    const next = snapshotFromMetas([
      meta("read_secrets", { name: "envelope", pgType: "jsonb", notNull: true }, "managed"),
    ]);
    const sql = renderMigrationSql(diffSnapshots(prev, next), {
      name: "secrets",
      sequenceNumber: 2,
    });
    expect(sql).toContain('DROP TABLE IF EXISTS "read_secrets";');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "read_secrets"');
    expect(sql).not.toContain("ADD COLUMN");
    expect(sql).toContain(
      "-- WARN: destructive change (new NOT NULL column(s) without default: envelope) forces DROP+CREATE + full event replay.",
    );
    expect(sql).toContain("Consider an Expand/Contract split across two releases");
  });

  test("managed: column rename (drop + add NOT NULL) → DROP+CREATE with new shape", () => {
    const prev = snapshotFromMetas([
      meta("read_a", { name: "old_name", pgType: "text", notNull: true }, "managed"),
    ]);
    const next = snapshotFromMetas([
      meta("read_a", { name: "new_name", pgType: "text", notNull: true }, "managed"),
    ]);
    const sql = renderMigrationSql(diffSnapshots(prev, next), {
      name: "rename",
      sequenceNumber: 3,
    });
    expect(sql).toContain('DROP TABLE IF EXISTS "read_a";');
    expect(sql).toContain('"new_name"');
    expect(sql).not.toContain("DROP COLUMN");
  });

  test("managed: additive nullable column → in-place ADD COLUMN, no recreate", () => {
    const prev = snapshotFromMetas([meta("read_a", undefined, "managed")]);
    const next = snapshotFromMetas([
      meta("read_a", { name: "note", pgType: "text", notNull: false }, "managed"),
    ]);
    const sql = renderMigrationSql(diffSnapshots(prev, next), { name: "note", sequenceNumber: 4 });
    expect(sql).toContain('ALTER TABLE "read_a" ADD COLUMN "note"');
    expect(sql).not.toContain("DROP TABLE");
    expect(sql).not.toContain("WARN: destructive change");
  });

  test("unmanaged: NOT NULL column without default → in-place ADD (real data, never recreated)", () => {
    const prev = snapshotFromMetas([meta("app_data")]);
    const next = snapshotFromMetas([
      meta("app_data", { name: "envelope", pgType: "jsonb", notNull: true }),
    ]);
    const sql = renderMigrationSql(diffSnapshots(prev, next), {
      name: "appdata",
      sequenceNumber: 5,
    });
    expect(sql).toContain('ALTER TABLE "app_data" ADD COLUMN "envelope"');
    expect(sql).not.toContain("DROP TABLE");
    expect(sql).not.toContain("WARN: destructive change");
  });

  test("unmanaged: timestamptz → date type change emits an explicit UTC-anchored USING clause (kumiko-framework#1924)", () => {
    // A bare `ALTER COLUMN ... TYPE date` (no USING) falls back to PG's
    // implicit ::date cast, which reads the session TimeZone — the exact
    // non-determinism this issue fixes. Managed tables never hit this path
    // (they DROP+CREATE + replay from events instead); unmanaged/store_*
    // tables carry real data through an in-place ALTER, so the generator
    // must anchor at UTC explicitly rather than emit the generic naive cast.
    const prev = snapshotFromMetas([
      meta("store_invoices", { name: "period_from", pgType: "timestamptz", notNull: true }),
    ]);
    const next = snapshotFromMetas([
      meta("store_invoices", { name: "period_from", pgType: "date", notNull: true }),
    ]);
    const sql = renderMigrationSql(diffSnapshots(prev, next), {
      name: "invoice-date",
      sequenceNumber: 7,
    });
    expect(sql).toContain(
      'ALTER TABLE "store_invoices" ALTER COLUMN "period_from" TYPE date USING ("period_from" AT TIME ZONE \'UTC\')::date;',
    );
    expect(sql).not.toContain("WARN: column-type-change");
  });

  test("unmanaged: date → timestamptz type change emits the symmetric UTC-anchored USING clause", () => {
    const prev = snapshotFromMetas([
      meta("store_invoices", { name: "period_from", pgType: "date", notNull: true }),
    ]);
    const next = snapshotFromMetas([
      meta("store_invoices", { name: "period_from", pgType: "timestamptz", notNull: true }),
    ]);
    const sql = renderMigrationSql(diffSnapshots(prev, next), {
      name: "invoice-date-widen",
      sequenceNumber: 8,
    });
    expect(sql).toContain(
      'ALTER TABLE "store_invoices" ALTER COLUMN "period_from" TYPE timestamptz USING ("period_from"::timestamp AT TIME ZONE \'UTC\');',
    );
    expect(sql).not.toContain("WARN: column-type-change");
  });

  test("managed: multiple recreate reasons at once → all named in the warning", () => {
    const prev = snapshotFromMetas([
      meta("read_b", { name: "old_col", pgType: "text", notNull: false }, "managed"),
    ]);
    const next = snapshotFromMetas([
      meta("read_b", { name: "envelope", pgType: "jsonb", notNull: true }, "managed"),
    ]);
    const sql = renderMigrationSql(diffSnapshots(prev, next), {
      name: "multi",
      sequenceNumber: 6,
    });
    expect(sql).toContain("dropped column(s): old_col");
    expect(sql).toContain("new NOT NULL column(s) without default: envelope");
  });
});

describe("renderMigrationSql — changed index predicates (kumiko-framework#2492)", () => {
  test("diffSnapshots surfaces a whereSql-only change as a changed table (not silently dropped)", () => {
    // Regression for the exact offlot#65 scenario: an index keeps its name
    // and columns, only its partial-index predicate widens (framework#2464
    // adding the soft-delete guard). Before the fix diffOneTable returned
    // null here — the table never reached changedTables at all.
    const prev = snapshotFromMetas([
      metaWithIndexes("read_users", [
        {
          name: "read_users_email_bidx",
          columns: ["email_bidx"],
          unique: true,
          whereSql: '"email_bidx" IS NOT NULL',
        },
      ]),
    ]);
    const next = snapshotFromMetas([
      metaWithIndexes("read_users", [
        {
          name: "read_users_email_bidx",
          columns: ["email_bidx"],
          unique: true,
          whereSql: '"email_bidx" IS NOT NULL AND "is_deleted" = false',
        },
      ]),
    ]);
    const diff = diffSnapshots(prev, next);
    expect(diff.changedTables).toHaveLength(1);
    expect(diff.changedTables[0]?.changedIndexes).toEqual([
      {
        name: "read_users_email_bidx",
        whereSqlChanged: {
          from: '"email_bidx" IS NOT NULL',
          to: '"email_bidx" IS NOT NULL AND "is_deleted" = false',
        },
      },
    ]);
  });

  test("emits DROP INDEX + CREATE INDEX with the new predicate", () => {
    const prev = snapshotFromMetas([
      metaWithIndexes("read_users", [
        {
          name: "read_users_email_bidx",
          columns: ["email_bidx"],
          unique: true,
          whereSql: '"email_bidx" IS NOT NULL',
        },
      ]),
    ]);
    const next = snapshotFromMetas([
      metaWithIndexes("read_users", [
        {
          name: "read_users_email_bidx",
          columns: ["email_bidx"],
          unique: true,
          whereSql: '"email_bidx" IS NOT NULL AND "is_deleted" = false',
        },
      ]),
    ]);
    const sql = renderMigrationSql(diffSnapshots(prev, next), {
      name: "predicate",
      sequenceNumber: 9,
    });
    expect(sql).toContain('DROP INDEX IF EXISTS "read_users_email_bidx";');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "read_users_email_bidx" ON "read_users" ("email_bidx") WHERE "email_bidx" IS NOT NULL AND "is_deleted" = false;',
    );
    expect(sql).toContain("changed (where");
  });

  test("emits DROP INDEX + CREATE INDEX when only the column list changes", () => {
    const prev = snapshotFromMetas([
      metaWithIndexes("read_orders", [{ name: "read_orders_status_idx", columns: ["status"] }]),
    ]);
    const next = snapshotFromMetas([
      metaWithIndexes("read_orders", [
        { name: "read_orders_status_idx", columns: ["status", "tenant_id"] },
      ]),
    ]);
    const sql = renderMigrationSql(diffSnapshots(prev, next), { name: "cols", sequenceNumber: 10 });
    expect(sql).toContain('DROP INDEX IF EXISTS "read_orders_status_idx";');
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS "read_orders_status_idx" ON "read_orders" ("status", "tenant_id");',
    );
  });

  test("emits DROP INDEX + CREATE UNIQUE INDEX when uniqueness changes on an existing index", () => {
    const prev = snapshotFromMetas([
      metaWithIndexes("read_orders", [{ name: "read_orders_ref_idx", columns: ["ref"] }]),
    ]);
    const next = snapshotFromMetas([
      metaWithIndexes("read_orders", [
        { name: "read_orders_ref_idx", columns: ["ref"], unique: true },
      ]),
    ]);
    const sql = renderMigrationSql(diffSnapshots(prev, next), {
      name: "unique",
      sequenceNumber: 11,
    });
    expect(sql).toContain('DROP INDEX IF EXISTS "read_orders_ref_idx";');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "read_orders_ref_idx"');
  });

  test("needsManualWhere: keeps both DROP and CREATE commented out — never drops a live index with no executable replacement", () => {
    const prev = snapshotFromMetas([
      metaWithIndexes("read_widgets", [
        { name: "read_widgets_active_idx", columns: ["status"], whereSql: "status = 'active'" },
      ]),
    ]);
    const next = snapshotFromMetas([
      metaWithIndexes("read_widgets", [
        { name: "read_widgets_active_idx", columns: ["status"], needsManualWhere: true },
      ]),
    ]);
    const sql = renderMigrationSql(diffSnapshots(prev, next), {
      name: "manual",
      sequenceNumber: 12,
    });
    expect(sql).toContain('-- (review) DROP INDEX IF EXISTS "read_widgets_active_idx";');
    expect(sql).not.toMatch(/^DROP INDEX IF EXISTS "read_widgets_active_idx";$/m);
    expect(sql).toContain('-- CREATE INDEX IF NOT EXISTS "read_widgets_active_idx"');
    expect(sql).not.toMatch(/^CREATE INDEX IF NOT EXISTS "read_widgets_active_idx"/m);
  });

  test("unchanged index (same name/columns/unique/whereSql) produces no diff at all", () => {
    const idx: IndexMeta = {
      name: "read_a_status_idx",
      columns: ["status"],
      whereSql: "status IS NOT NULL",
    };
    const prev = snapshotFromMetas([metaWithIndexes("read_a", [idx])]);
    const next = snapshotFromMetas([metaWithIndexes("read_a", [{ ...idx }])]);
    expect(diffSnapshots(prev, next).changedTables).toEqual([]);
  });

  test("new index with needsManualWhere is rendered commented-out, not silently as a bare CREATE INDEX (render-ddl consolidation)", () => {
    // migrate-generator.ts used to carry its own renderIndex() copy that
    // didn't check needsManualWhere — a new partial index with an
    // unrenderable WHERE was emitted as a plain, uncommented CREATE INDEX
    // with the predicate silently dropped. Now it shares render-ddl.ts's
    // renderIndex, which comments the statement out for manual review.
    const prev = snapshotFromMetas([meta("read_c", undefined, "unmanaged")]);
    const next = snapshotFromMetas([
      metaWithIndexes(
        "read_c",
        [{ name: "read_c_status_idx", columns: ["status"], needsManualWhere: true }],
        "unmanaged",
      ),
    ]);
    const sql = renderMigrationSql(diffSnapshots(prev, next), {
      name: "newpartial",
      sequenceNumber: 13,
    });
    expect(sql).toContain('-- CREATE INDEX IF NOT EXISTS "read_c_status_idx"');
    expect(sql).not.toMatch(/^CREATE INDEX IF NOT EXISTS "read_c_status_idx"/m);
  });
});

describe("assertValidMigrationName", () => {
  test("accepts alphanumeric hyphenated names", () => {
    expect(() => assertValidMigrationName("add-user-table")).not.toThrow();
  });

  test("rejects leading hyphen and oversized names", () => {
    expect(() => assertValidMigrationName("-foo")).toThrow(/Invalid migration name/);
    expect(() => assertValidMigrationName(`a${"x".repeat(64)}`)).toThrow(/Invalid migration name/);
  });
});

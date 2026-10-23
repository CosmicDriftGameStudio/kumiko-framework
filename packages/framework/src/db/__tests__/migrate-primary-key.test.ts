import { describe, expect, test } from "bun:test";
import type { EntityTableMeta } from "../entity-table-meta.ts";
import { diffSnapshots, renderMigrationSql, snapshotFromMetas } from "../migrate-generator.ts";

const idColumn = { name: "id", pgType: "uuid", notNull: true } as const;
const tenantColumn = { name: "tenant_id", pgType: "uuid", notNull: true } as const;

function table(
  columns: EntityTableMeta["columns"],
  compositePrimaryKey?: EntityTableMeta["compositePrimaryKey"],
  source: EntityTableMeta["source"] = "unmanaged",
): EntityTableMeta {
  return {
    tableName: "orders",
    source,
    indexes: [],
    columns,
    ...(compositePrimaryKey && { compositePrimaryKey }),
  };
}

const singlePk = table([{ ...idColumn, primaryKey: true }, tenantColumn]);
const compositePk = table([idColumn, tenantColumn], {
  name: "orders_pkey",
  columns: ["tenant_id", "id"],
});

function render(prev: EntityTableMeta, next: EntityTableMeta): string {
  return renderMigrationSql(diffSnapshots(snapshotFromMetas([prev]), snapshotFromMetas([next])), {
    name: "pk",
    sequenceNumber: 2,
  });
}

describe("primary-key diff", () => {
  test("single → composite emits DROP CONSTRAINT and ADD CONSTRAINT", () => {
    const sql = render(singlePk, compositePk);
    expect(sql).toContain('ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_pkey";');
    expect(sql).toContain(
      'ALTER TABLE "orders" ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("tenant_id", "id");',
    );
    expect(sql).toContain("-- WARN: primary-key change (id → tenant_id, id)");
  });

  test("a key over a column added in the same diff comes after its ADD COLUMN", () => {
    const withRegion = table(
      [idColumn, tenantColumn, { name: "region", pgType: "text", notNull: true }],
      { name: "orders_pkey", columns: ["tenant_id", "region", "id"] },
    );
    const sql = render(singlePk, withRegion);
    const addColumnAt = sql.indexOf('ADD COLUMN "region"');
    const addKeyAt = sql.indexOf('ADD CONSTRAINT "orders_pkey" PRIMARY KEY');
    expect(addColumnAt).toBeGreaterThan(-1);
    expect(addKeyAt).toBeGreaterThan(addColumnAt);
  });

  test("column order inside a composite key is a change", () => {
    const reordered = table([idColumn, tenantColumn], {
      name: "orders_pkey",
      columns: ["id", "tenant_id"],
    });
    expect(
      diffSnapshots(snapshotFromMetas([compositePk]), snapshotFromMetas([reordered])).changedTables,
    ).toHaveLength(1);
  });

  test("renamed composite constraint is a change", () => {
    const renamed = table([idColumn, tenantColumn], {
      name: "orders_tenant_pk",
      columns: ["tenant_id", "id"],
    });
    const sql = render(compositePk, renamed);
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "orders_pkey"');
    expect(sql).toContain('ADD CONSTRAINT "orders_tenant_pk"');
  });

  test("unchanged key produces no diff, also for snapshots without primaryKey flags", () => {
    const legacyColumns = table([{ name: "id", pgType: "uuid", notNull: true, primaryKey: true }]);
    const diff = diffSnapshots(
      snapshotFromMetas([legacyColumns]),
      snapshotFromMetas([legacyColumns]),
    );
    expect(diff.changedTables).toEqual([]);
  });

  test("managed projection with a changed key is recreated and replayed", () => {
    const sql = render({ ...singlePk, source: "managed" }, { ...compositePk, source: "managed" });
    expect(sql).toContain('DROP TABLE IF EXISTS "orders";');
    expect(sql).toContain("primary-key change: id → tenant_id, id");
    expect(sql).not.toContain("DROP CONSTRAINT");
  });
});

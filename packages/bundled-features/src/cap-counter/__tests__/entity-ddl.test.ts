import { describe, expect, test } from "bun:test";
import {
  capCountersTableMeta,
  capReservationsTableMeta,
  rollingCapUsageTableMeta,
} from "../tables.ts";

function pgTypeOf(table: unknown, dbName: string): string | undefined {
  const cols = (table as { columns?: ReadonlyArray<{ name: string; pgType?: string }> }).columns;
  return cols?.find((c) => c.name === dbName)?.pgType;
}

describe("cap-counter store tables — DDL", () => {
  test("counter table meta matches the hand-frozen DDL", () => {
    expect(capCountersTableMeta.tableName).toBe("store_cap_counters");
    expect(capCountersTableMeta.columns).toEqual([
      { name: "tenant_id", pgType: "uuid", notNull: true },
      { name: "cap_name", pgType: "text", notNull: true },
      { name: "period_start", pgType: "timestamptz", notNull: true },
      { name: "subject_hash", pgType: "text", notNull: true },
      { name: "value", pgType: "bigint", notNull: true },
      { name: "last_soft_warned_at", pgType: "timestamptz", notNull: false },
    ]);
    expect(capCountersTableMeta.compositePrimaryKey).toMatchObject({
      columns: ["tenant_id", "cap_name", "period_start", "subject_hash"],
    });
    expect(capCountersTableMeta.indexes).toMatchObject([
      { name: "store_cap_counters_subject_hash_idx", columns: ["subject_hash"] },
    ]);
  });

  test("reservation table carries the nullable settled_at tombstone column", () => {
    const column = capReservationsTableMeta.columns.find((c) => c.name === "settled_at");
    expect(column).toEqual({ name: "settled_at", pgType: "timestamptz", notNull: false });
  });

  test("reservation table meta matches the hand-frozen DDL", () => {
    expect(capReservationsTableMeta.tableName).toBe("store_cap_reservations");
    expect(capReservationsTableMeta.columns).toEqual([
      { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
      { name: "tenant_id", pgType: "uuid", notNull: true },
      { name: "cap_name", pgType: "text", notNull: true },
      { name: "kind", pgType: "text", notNull: true },
      { name: "period_start_iso", pgType: "text", notNull: false },
      { name: "amount", pgType: "integer", notNull: true },
      { name: "expires_at", pgType: "timestamptz", notNull: true },
      { name: "created_at", pgType: "timestamptz", notNull: true },
      { name: "settled_at", pgType: "timestamptz", notNull: false },
      { name: "consumed_amount", pgType: "integer", notNull: true, defaultSql: "0" },
      { name: "released_at", pgType: "timestamptz", notNull: false },
      { name: "subject_hash", pgType: "text", notNull: false },
    ]);
    expect(capReservationsTableMeta.indexes).toMatchObject([
      {
        name: "store_cap_reservations_tenant_id_cap_name_expires_at_idx",
        columns: ["tenant_id", "cap_name", "expires_at"],
      },
    ]);
  });

  test("rolling usage table is keyed per tenant, cap and hour", () => {
    expect(rollingCapUsageTableMeta.tableName).toBe("store_cap_rolling_usage");
    expect(rollingCapUsageTableMeta.compositePrimaryKey).toMatchObject({
      columns: ["tenant_id", "cap_name", "bucket_start"],
    });
    expect(pgTypeOf(rollingCapUsageTableMeta, "amount")).toBe("bigint");
  });
});

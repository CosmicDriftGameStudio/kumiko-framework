import { describe, expect, test } from "bun:test";
import type { EntityTableMeta } from "../../entity-table-meta";
import { fenceLiveTable, rebuildMetaOrThrow } from "../shadow-swap";

const cleanMeta: EntityTableMeta = {
  tableName: "read_x",
  source: "managed",
  columns: [{ name: "id", pgType: "uuid", notNull: true, primaryKey: true }],
  indexes: [{ name: "read_x_tenant_id_idx", columns: ["tenant_id"] }],
};

describe("rebuildMetaOrThrow", () => {
  test("returns the resolved meta for a clean projection table", () => {
    expect(rebuildMetaOrThrow(cleanMeta, "feat:projection:x")).toBe(cleanMeta);
  });

  test("throws when the table object carries no resolvable EntityTableMeta", () => {
    expect(() => rebuildMetaOrThrow({}, "feat:projection:x")).toThrow(
      /no resolvable EntityTableMeta/,
    );
  });

  test("rejects a meta-inexpressible partial index instead of silently dropping it", () => {
    const meta: EntityTableMeta = {
      ...cleanMeta,
      indexes: [{ name: "read_x_active_idx", columns: ["status"], needsManualWhere: true }],
    };
    expect(() => rebuildMetaOrThrow(meta, "feat:projection:x")).toThrow(/partial index/);
  });
});

describe("fenceLiveTable lock-timeout guard", () => {
  // The guard rejects before any DB work, so the tx is never touched.
  const noTx = {} as never;

  test("rejects lockTimeoutMs = 0 (Postgres reads 0 as wait-forever, not fail-fast)", async () => {
    await expect(fenceLiveTable(noTx, "read_x", 0)).rejects.toThrow(/must be > 0/);
  });

  test("rejects a negative lockTimeoutMs", async () => {
    await expect(fenceLiveTable(noTx, "read_x", -5)).rejects.toThrow(/must be > 0/);
  });
});

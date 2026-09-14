import { describe, expect, test } from "bun:test";
import { createTenantDb, type DbRunner } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { selectConfigRowsForKeys, selectConfigRowsForScope } from "../resolver";

type FakeClient = {
  unsafe: (sql: string, params?: readonly unknown[]) => Promise<readonly unknown[]>;
  begin: () => never;
  calls: number;
};

function fakeClient(rowsPerCall: readonly (readonly Record<string, unknown>[])[]): FakeClient {
  const client: FakeClient = {
    calls: 0,
    unsafe: async () => {
      const rows = rowsPerCall[client.calls] ?? [];
      client.calls++;
      return rows;
    },
    begin: () => {
      throw new Error("not used in test");
    },
  };
  return client;
}

describe("config db/queries/resolver — scope-bucket merge", () => {
  test("selectConfigRowsForScope merges the scope bucket and the user bucket", async () => {
    const db = fakeClient([
      [{ id: "sys-1", key: "k1", value: "v-sys", tenantId: "system", userId: null }],
      [{ id: "user-1", key: "k1", value: "v-user", tenantId: "t1", userId: "u1" }],
    ]);
    const rows = await selectConfigRowsForScope(db as never, "system", "t1", "u1");
    expect(db.calls).toBe(2);
    expect(rows.map((r) => r.id).sort()).toEqual(["sys-1", "user-1"]);
  });

  test("selectConfigRowsForKeys merges the scope bucket and the user bucket", async () => {
    const db = fakeClient([
      [{ id: "sys-1", key: "k1", value: "v-sys", tenantId: "system", userId: null }],
      [{ id: "user-1", key: "k1", value: "v-user", tenantId: "t1", userId: "u1" }],
    ]);
    const rows = await selectConfigRowsForKeys(db as never, ["k1"], "system", "t1", "u1");
    expect(db.calls).toBe(2);
    expect(rows.map((r) => r.id).sort()).toEqual(["sys-1", "user-1"]);
  });

  test("selectConfigRowsForKeys returns [] without querying when keys is empty", async () => {
    const db = fakeClient([]);
    const rows = await selectConfigRowsForKeys(db as never, [], "system", "t1", "u1");
    expect(rows).toEqual([]);
    expect(db.calls).toBe(0);
  });
});

describe("config db/queries/resolver — tenant-mode TenantDb narrowing", () => {
  test("selectConfigRowsForScope's tenantId array survives readWhere's narrowing", async () => {
    const captured: { sql: string; values: readonly unknown[] }[] = [];
    const recordingRunner = {
      unsafe: async (sql: string, values: readonly unknown[]) => {
        captured.push({ sql, values });
        return [] as unknown[];
      },
      begin: async () => {
        throw new Error("not used in test");
      },
    } as unknown as DbRunner;
    const tdb = createTenantDb(recordingRunner, "t1");

    await selectConfigRowsForScope(tdb, SYSTEM_TENANT_ID, "t1", "u1");

    expect(captured).toHaveLength(2);
    expect(captured[0]?.sql).toMatch(/tenant_id" IN /i);
    expect(captured[0]?.values).toContain(SYSTEM_TENANT_ID);
    expect(captured[0]?.values).toContain("t1");
  });
});

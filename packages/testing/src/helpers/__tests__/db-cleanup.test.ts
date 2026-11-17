import { describe, expect, test } from "bun:test";
import type { EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import { clearTables } from "../db-cleanup.ts";

describe("db-cleanup", () => {
  test("clearTables issues DELETE without WHERE per table via deleteMany", async () => {
    const sqlLog: string[] = [];
    const mockDb = {
      unsafe: async (sql: string) => {
        sqlLog.push(sql);
        return Object.assign([], { count: 0 });
      },
      begin: async () => {
        throw new Error("unused in this test");
      },
    };

    await clearTables(mockDb, ["read_users", "kumiko_events"]);

    expect(sqlLog).toHaveLength(2);
    expect(sqlLog[0]).toBe('DELETE FROM "read_users"');
    expect(sqlLog[1]).toBe('DELETE FROM "kumiko_events"');
  });

  test("clearTables accepts EntityTableMeta-shaped tables", async () => {
    const sqlLog: string[] = [];
    const mockDb = {
      unsafe: async (sql: string) => {
        sqlLog.push(sql);
        return Object.assign([], { count: 0 });
      },
      begin: async () => {
        throw new Error("unused in this test");
      },
    };

    const userTable: EntityTableMeta = {
      source: "managed",
      tableName: "read_users",
      columns: [{ name: "id", pgType: "uuid", notNull: true, primaryKey: true }],
      indexes: [],
    };

    await clearTables(mockDb, [userTable]);
    expect(sqlLog[0]).toBe('DELETE FROM "read_users"');
  });
});

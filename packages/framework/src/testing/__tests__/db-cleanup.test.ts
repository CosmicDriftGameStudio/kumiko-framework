import { describe, expect, test } from "bun:test";
import { clearTables } from "../db-cleanup";

describe("db-cleanup", () => {
  test("clearTables issues DELETE without WHERE per table via deleteMany", async () => {
    const sqlLog: string[] = [];
    const mockDb = {
      unsafe: async (sql: string) => {
        sqlLog.push(sql);
        return [];
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
        return [];
      },
    };

    const userTable = {
      source: "managed" as const,
      tableName: "read_users",
      columns: [{ name: "id", pgType: "uuid", notNull: true, primaryKey: true }],
      indexes: [],
    };

    await clearTables(mockDb, [userTable]);
    expect(sqlLog[0]).toBe('DELETE FROM "read_users"');
  });
});

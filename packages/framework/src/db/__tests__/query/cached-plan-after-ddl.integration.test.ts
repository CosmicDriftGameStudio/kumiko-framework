// Bun.SQL before 1.4.4 kept a prepared statement's plan across DDL on the same
// connection and failed with 0A000 "cached plan must not change result type"
// (oven-sh/bun#29484). Projection rebuilds and column DDL run exactly this
// sequence, so a Bun regression must fail here first.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { testDatabaseUrl } from "@cosmicdrift/kumiko-testing/helpers";
import { uniqueTableName } from "./_helpers.ts";

let pool: InstanceType<typeof Bun.SQL>;

beforeAll(() => {
  pool = new Bun.SQL(testDatabaseUrl(), { max: 1 });
});

afterAll(async () => {
  await pool.close({ timeout: 5 });
});

describe("cached statement after DDL on the same connection", () => {
  test("SELECT * sees a column added after the statement was prepared", async () => {
    const table = uniqueTableName("cached_plan");
    const connection = await pool.reserve();
    try {
      await connection.unsafe(`CREATE TABLE ${table} (id integer PRIMARY KEY)`);
      await connection.unsafe(`INSERT INTO ${table} (id) VALUES (1)`);
      const selectById = `SELECT * FROM ${table} WHERE id = $1`;

      expect([...(await connection.unsafe(selectById, [1]))]).toEqual([{ id: 1 }]);
      await connection.unsafe(`ALTER TABLE ${table} ADD COLUMN label text NOT NULL DEFAULT 'x'`);

      expect([...(await connection.unsafe(selectById, [1]))]).toEqual([{ id: 1, label: "x" }]);
    } finally {
      await connection.unsafe(`DROP TABLE IF EXISTS ${table}`);
      connection.release();
    }
  });
});

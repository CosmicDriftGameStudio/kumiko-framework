import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../../bun-db/__tests__/bun-test-db.js";
import { asRawClient } from "../../query.js";
import { toPostgresArrayLiteral } from "../postgres-array-literal.js";

let testDb: BunTestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.cleanup();
});

async function roundtripText(values: readonly (string | null)[]): Promise<(string | null)[]> {
  const rows = await asRawClient(testDb.db).unsafe<{ v: string | null }>(
    `SELECT v FROM unnest($1::text[]) WITH ORDINALITY AS t(v, n) ORDER BY n`,
    [toPostgresArrayLiteral(values)],
  );
  return rows.map((row) => row.v);
}

describe("toPostgresArrayLiteral against Postgres", () => {
  test("text[] roundtrips special characters, unicode and NULL", async () => {
    const values = ["a", "b,c", 'say "hi"', "back\\slash", "{x}", "NULL", "", "äöü 😀", null];
    expect(await roundtripText(values)).toEqual(values);
  });

  test("empty array yields no rows", async () => {
    expect(await roundtripText([])).toEqual([]);
  });

  test("uuid[] and bigint[] params work with ANY", async () => {
    const id = "6f1c1a3e-0a52-4a52-9a43-3d1a1b1c1d1e";
    const rows = await asRawClient(testDb.db).unsafe<{ u: boolean; b: boolean }>(
      `SELECT $1::uuid = ANY($2::uuid[]) AS u, 9007199254740993::bigint = ANY($3::bigint[]) AS b`,
      [id, toPostgresArrayLiteral([id]), toPostgresArrayLiteral([9007199254740993n])],
    );
    expect(rows[0]).toEqual({ u: true, b: true });
  });
});

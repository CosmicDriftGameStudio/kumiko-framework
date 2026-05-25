import { describe, expect, test } from "bun:test";
import { splitSqlStatements } from "../migrate-runner";

describe("splitSqlStatements", () => {
  test("splits on semicolons and strips line comments", () => {
    const sql = `
      CREATE TABLE "a" (id uuid); -- inline comment
      CREATE TABLE "b" (id uuid);
    `;
    expect(splitSqlStatements(sql)).toEqual([
      'CREATE TABLE "a" (id uuid);',
      'CREATE TABLE "b" (id uuid);',
    ]);
  });

  test("filters empty segments", () => {
    expect(splitSqlStatements("-- only comments\n; ;")).toEqual([]);
  });
});

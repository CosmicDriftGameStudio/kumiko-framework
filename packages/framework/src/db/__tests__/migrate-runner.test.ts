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

  test("does not split mid-statement on a semicolon inside a line comment", () => {
    const sql = `
      -- sets default on the entity; the create/update handlers fill it
      CREATE TABLE "a" ("id" uuid);
    `;
    expect(splitSqlStatements(sql)).toEqual(['CREATE TABLE "a" ("id" uuid);']);
  });

  test("does not split on a semicolon inside a block comment", () => {
    const sql = `
      /* multi
         line; with semi */
      CREATE TABLE "a" ("id" uuid);
    `;
    expect(splitSqlStatements(sql)).toEqual(['CREATE TABLE "a" ("id" uuid);']);
  });

  test("block comment leaves a space so adjacent tokens do not fuse", () => {
    expect(splitSqlStatements("SELECT a/*x*/AS b;")).toEqual(["SELECT a AS b;"]);
  });

  test("nested block comment also leaves a space at outer depth (#1599)", () => {
    expect(splitSqlStatements("SELECT a/*x/*y*/z*/AS b;")).toEqual(["SELECT a AS b;"]);
  });

  test("nested block comments close only at matching depth (Postgres)", () => {
    expect(splitSqlStatements("/* a /* b */ c */ SELECT 1;")).toEqual(["SELECT 1;"]);
  });

  test("a block-comment opener inside a line comment does not swallow the next statement", () => {
    const sql = `
      -- note: see /* details below
      CREATE TABLE "a" ("id" uuid);
      /* real block comment */
      CREATE TABLE "b" ("id" uuid);
    `;
    expect(splitSqlStatements(sql)).toEqual([
      'CREATE TABLE "a" ("id" uuid);',
      'CREATE TABLE "b" ("id" uuid);',
    ]);
  });

  test("does not split on a semicolon inside a single-quoted string literal", () => {
    const sql = `INSERT INTO "a" ("v") VALUES ('a;b');`;
    expect(splitSqlStatements(sql)).toEqual([`INSERT INTO "a" ("v") VALUES ('a;b');`]);
  });

  test("does not treat a double-dash inside a string literal as a comment", () => {
    const sql = `INSERT INTO "a" ("v") VALUES ('a--b');`;
    expect(splitSqlStatements(sql)).toEqual([`INSERT INTO "a" ("v") VALUES ('a--b');`]);
  });

  test("handles an escaped quote inside a single-quoted string literal ('')", () => {
    const sql = `INSERT INTO "a" ("v") VALUES ('a'';b');`;
    expect(splitSqlStatements(sql)).toEqual([`INSERT INTO "a" ("v") VALUES ('a'';b');`]);
  });

  test("does not split on a semicolon inside a double-quoted identifier", () => {
    const sql = `CREATE TABLE "weird;name" ("id" uuid);`;
    expect(splitSqlStatements(sql)).toEqual([`CREATE TABLE "weird;name" ("id" uuid);`]);
  });

  test("throws fail-loud on an unterminated block comment instead of silently dropping statements", () => {
    const sql = `/* oops\nCREATE TABLE "a" ("id" uuid);`;
    expect(() => splitSqlStatements(sql)).toThrow(/unterminated blockComment/);
  });

  test("throws fail-loud on an unterminated single-quoted string", () => {
    const sql = `INSERT INTO "a" ("v") VALUES ('oops;`;
    expect(() => splitSqlStatements(sql)).toThrow(/unterminated singleQuote/);
  });

  test("throws fail-loud on an unterminated double-quoted identifier", () => {
    const sql = `CREATE TABLE "weird;`;
    expect(() => splitSqlStatements(sql)).toThrow(/unterminated doubleQuote/);
  });

  test("a trailing line comment without a newline terminates cleanly", () => {
    expect(splitSqlStatements('CREATE TABLE "a" ("id" uuid);\n-- done')).toEqual([
      'CREATE TABLE "a" ("id" uuid);',
    ]);
  });

  test("throws fail-loud on a dollar-quoted body instead of splitting it in half", () => {
    expect(() => splitSqlStatements("DO $$ BEGIN PERFORM 1; END $$;")).toThrow(
      /unsupported dollar-quoted body/,
    );
  });

  test("throws fail-loud on a tagged dollar-quoted body ($tag$...$tag$)", () => {
    expect(() => splitSqlStatements("DO $tag$ BEGIN PERFORM 1; END $tag$;")).toThrow(
      /unsupported dollar-quoted body/,
    );
  });

  test("a bare $ not opening a dollar-tag does not false-positive (digit after $ is not a tag)", () => {
    expect(splitSqlStatements("SELECT $1;")).toEqual(["SELECT $1;"]);
  });
});

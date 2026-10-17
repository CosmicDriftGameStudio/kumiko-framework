import { describe, expect, test } from "bun:test";
import { runnerCanBeginTransaction } from "../query.js";

const unsafe = async () => [];
const begin = async () => undefined;
const savepoint = async () => undefined;

describe("runnerCanBeginTransaction", () => {
  test("Bun.SQL pool: true", () => {
    expect(runnerCanBeginTransaction({ unsafe, begin })).toBe(true);
  });
  test("Bun.SQL tx/savepoint handle (begin + savepoint): false", () => {
    expect(runnerCanBeginTransaction({ unsafe, begin, savepoint })).toBe(false);
  });
  test("postgres.js pool: true", () => {
    expect(runnerCanBeginTransaction({ unsafe, begin })).toBe(true);
  });
  test("postgres.js tx (savepoint only): false", () => {
    expect(runnerCanBeginTransaction({ unsafe, savepoint })).toBe(false);
  });
});

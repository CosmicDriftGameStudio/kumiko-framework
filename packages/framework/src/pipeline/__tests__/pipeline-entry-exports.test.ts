import { describe, expect, test } from "bun:test";
import { isFailedWriteResult } from "@cosmicdrift/kumiko-framework/pipeline";
import { UnprocessableError, writeFailure } from "../../errors/index.js";

describe("isFailedWriteResult via pipeline entry", () => {
  test("false for a successful write result", () => {
    expect(isFailedWriteResult({ isSuccess: true, data: {} })).toBe(false);
  });

  test("true for writeFailure()", () => {
    expect(isFailedWriteResult(writeFailure(new UnprocessableError("nope")))).toBe(true);
  });

  test("false for non-write values", () => {
    expect(isFailedWriteResult(undefined)).toBe(false);
    expect(isFailedWriteResult("x")).toBe(false);
    expect(isFailedWriteResult({ kind: "created" })).toBe(false);
  });
});

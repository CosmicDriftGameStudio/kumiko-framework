import { describe, expect, test } from "bun:test";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import { UnprocessableError, VersionConflictError } from "../classes.ts";
import { isVersionConflictFailure, retryOnceOnVersionConflict } from "../version-conflict-retry.ts";
import { writeFailure } from "../write-error-info.ts";

const conflict = () =>
  writeFailure(new VersionConflictError({ entityId: "e1", expectedVersion: 1, currentVersion: 2 }));
const unprocessable = () => writeFailure(new UnprocessableError("some_reason"));

function scripted(results: readonly WriteResult<number>[]) {
  const state = { calls: 0 };
  const attempt = async (): Promise<WriteResult<number>> => {
    const result = results[Math.min(state.calls, results.length - 1)];
    state.calls++;
    if (result === undefined) throw new Error("no scripted result");
    return result;
  };
  return { state, attempt };
}

describe("isVersionConflictFailure", () => {
  test("is true only for a version conflict failure", () => {
    expect(isVersionConflictFailure(conflict())).toBe(true);
    expect(isVersionConflictFailure(unprocessable())).toBe(false);
    expect(isVersionConflictFailure({ isSuccess: true, data: 1 })).toBe(false);
  });
});

describe("retryOnceOnVersionConflict", () => {
  test("retries once after a version conflict and returns the second result", async () => {
    const { state, attempt } = scripted([conflict(), { isSuccess: true, data: 1 }]);
    const result = await retryOnceOnVersionConflict(attempt);
    expect(result).toEqual({ isSuccess: true, data: 1 });
    expect(state.calls).toBe(2);
  });

  test("returns a second conflict without a third attempt", async () => {
    const second = conflict();
    const { state, attempt } = scripted([conflict(), second]);
    const result = await retryOnceOnVersionConflict(attempt);
    expect(result).toBe(second);
    expect(state.calls).toBe(2);
  });

  test("does not retry other failures", async () => {
    const failure = unprocessable();
    const { state, attempt } = scripted([failure]);
    const result = await retryOnceOnVersionConflict(attempt);
    expect(result).toBe(failure);
    expect(state.calls).toBe(1);
  });
});

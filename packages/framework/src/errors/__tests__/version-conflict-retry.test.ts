import { describe, expect, test } from "bun:test";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import { InternalError, UnprocessableError, VersionConflictError } from "../classes.ts";
import { VERSION_CONFLICT_CODE } from "../error-codes.ts";
import { retryOnVersionConflict } from "../version-conflict-retry.ts";
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

describe("retryOnVersionConflict", () => {
  test("retries once after a version conflict and returns the second result", async () => {
    const { state, attempt } = scripted([conflict(), { isSuccess: true, data: 1 }]);
    const result = await retryOnVersionConflict(attempt);
    expect(result).toEqual({ isSuccess: true, data: 1 });
    expect(state.calls).toBe(2);
  });

  test("returns a second conflict without a third attempt", async () => {
    const second = conflict();
    const { state, attempt } = scripted([conflict(), second]);
    const result = await retryOnVersionConflict(attempt);
    expect(result).toBe(second);
    expect(state.calls).toBe(2);
  });

  test("does not retry other failures", async () => {
    const failure = unprocessable();
    const { state, attempt } = scripted([failure]);
    const result = await retryOnVersionConflict(attempt);
    expect(result).toBe(failure);
    expect(state.calls).toBe(1);
  });

  test("retries up to maxAttempts until the write succeeds", async () => {
    const { state, attempt } = scripted([conflict(), conflict(), { isSuccess: true, data: 1 }]);
    const result = await retryOnVersionConflict(attempt, { maxAttempts: 3 });
    expect(result).toEqual({ isSuccess: true, data: 1 });
    expect(state.calls).toBe(3);
  });

  test("returns the last conflict after maxAttempts", async () => {
    const third = conflict();
    const { state, attempt } = scripted([conflict(), conflict(), third, conflict()]);
    const result = await retryOnVersionConflict(attempt, { maxAttempts: 3 });
    expect(result).toBe(third);
    expect(state.calls).toBe(3);
  });

  test("maxAttempts 1 makes a single attempt", async () => {
    const { state, attempt } = scripted([conflict()]);
    await retryOnVersionConflict(attempt, { maxAttempts: 1 });
    expect(state.calls).toBe(1);
  });

  test("an invalid maxAttempts throws before any attempt", async () => {
    const { state, attempt } = scripted([conflict()]);
    await expect(retryOnVersionConflict(attempt, { maxAttempts: 0 })).rejects.toThrow(
      InternalError,
    );
    await expect(retryOnVersionConflict(attempt, { maxAttempts: 1.5 })).rejects.toThrow(
      InternalError,
    );
    expect(state.calls).toBe(0);
  });
});

describe("VERSION_CONFLICT_CODE", () => {
  test("is the code of VersionConflictError", () => {
    expect(
      new VersionConflictError({ entityId: "e1", expectedVersion: 1, currentVersion: 2 }).code,
    ).toBe(VERSION_CONFLICT_CODE);
  });
});

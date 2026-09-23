import { describe, expect, test } from "bun:test";
import type { SessionBootstrapFailure } from "../session";
import { retryDelayMs } from "../session-bootstrap-error";

describe("retryDelayMs", () => {
  test("Retry-After not yet elapsed → remaining delay in ms", () => {
    const failure: SessionBootstrapFailure = {
      httpStatus: 429,
      retryAfterSeconds: 11,
      failedAtEpochMs: 1000,
    };
    expect(retryDelayMs(failure, 3000)).toBe(9000);
  });

  test("Retry-After already elapsed → 0, never negative", () => {
    const failure: SessionBootstrapFailure = {
      httpStatus: 429,
      retryAfterSeconds: 11,
      failedAtEpochMs: 1000,
    };
    expect(retryDelayMs(failure, 20_000)).toBe(0);
  });

  test("no retryAfterSeconds → 0 (retry immediately)", () => {
    const failure: SessionBootstrapFailure = {
      httpStatus: 500,
      retryAfterSeconds: null,
      failedAtEpochMs: 1000,
    };
    expect(retryDelayMs(failure, 1000)).toBe(0);
  });
});

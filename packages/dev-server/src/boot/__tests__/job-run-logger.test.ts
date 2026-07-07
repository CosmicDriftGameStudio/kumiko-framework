import { describe, expect, test } from "bun:test";
import { createJobsFeature } from "@cosmicdrift/kumiko-bundled-features/jobs";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createRegistry, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { jobRunLoggerCallbacks } from "../job-run-logger";

// ponytail: callbacks shape only — no DB I/O; createTestDb needs TEST_DATABASE_URL (CI unit job has none).
const mockDb = {} as DbConnection;

describe("jobRunLoggerCallbacks", () => {
  test("returns undefined when jobs feature is not registered", () => {
    const registry = createRegistry([
      defineFeature("empty", () => ({ handlers: {}, queries: {} })),
    ]);
    expect(jobRunLoggerCallbacks(registry, mockDb)).toBeUndefined();
  });

  test("returns logger callbacks when jobs feature is registered", () => {
    const registry = createRegistry([createJobsFeature()]);
    const callbacks = jobRunLoggerCallbacks(registry, mockDb);
    expect(callbacks).toBeDefined();
    expect(typeof callbacks?.onJobStart).toBe("function");
    expect(typeof callbacks?.onJobComplete).toBe("function");
    expect(typeof callbacks?.onJobFailed).toBe("function");
  });
});

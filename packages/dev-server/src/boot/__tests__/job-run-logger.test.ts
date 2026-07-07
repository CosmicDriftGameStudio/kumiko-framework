import { describe, expect, test } from "bun:test";
import { createJobsFeature } from "@cosmicdrift/kumiko-bundled-features/jobs";
import { createRegistry, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createTestDb } from "@cosmicdrift/kumiko-framework/stack";
import { jobRunLoggerCallbacks } from "../job-run-logger";

describe("jobRunLoggerCallbacks", () => {
  test("returns undefined when jobs feature is not registered", async () => {
    const testDb = await createTestDb();
    try {
      const registry = createRegistry([
        defineFeature("empty", () => ({ handlers: {}, queries: {} })),
      ]);
      expect(jobRunLoggerCallbacks(registry, testDb.db)).toBeUndefined();
    } finally {
      await testDb.cleanup();
    }
  });

  test("returns logger callbacks when jobs feature is registered", async () => {
    const testDb = await createTestDb();
    try {
      const registry = createRegistry([createJobsFeature()]);
      const callbacks = jobRunLoggerCallbacks(registry, testDb.db);
      expect(callbacks).toBeDefined();
      expect(typeof callbacks?.onJobStart).toBe("function");
      expect(typeof callbacks?.onJobComplete).toBe("function");
      expect(typeof callbacks?.onJobFailed).toBe("function");
    } finally {
      await testDb.cleanup();
    }
  });
});

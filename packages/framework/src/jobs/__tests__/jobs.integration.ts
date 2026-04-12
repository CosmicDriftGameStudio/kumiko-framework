import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createRegistry, defineFeature } from "../../engine";
import type { AppContext, Registry } from "../../engine/types";
import { createTestRedis, sleep, type TestRedis, waitFor } from "../../testing";
import { createJobRunner, type JobRunner } from "../job-runner";

// --- Shared state ---

let testRedis: TestRedis;
let redisUrl: string;

// Track which jobs ran and when
const jobLog: Array<{ name: string; payload: Record<string, unknown>; timestamp: number }> = [];

function clearLog() {
  jobLog.length = 0;
}

// --- Feature with test jobs ---

const testFeature = defineFeature("test", (r) => {
  // Scenario 1: Boot job
  r.job("bootSync", { trigger: { manual: true }, runOnBoot: true }, async (payload) => {
    jobLog.push({ name: "test.bootSync", payload, timestamp: Date.now() });
  });

  // Scenario 2: Scheduled job (cron every second for testing)
  r.job("scheduled", { trigger: { cron: "* * * * * *" } }, async (payload) => {
    jobLog.push({ name: "test.scheduled", payload, timestamp: Date.now() });
  });

  // Scenario 3: Manual trigger
  r.job("manualReport", { trigger: { manual: true } }, async (payload) => {
    jobLog.push({ name: "test.manualReport", payload, timestamp: Date.now() });
  });

  // Concurrency: skip — if running, skip new
  r.job("skipJob", { trigger: { manual: true }, concurrency: "skip" }, async (payload) => {
    jobLog.push({ name: "test.skipJob", payload, timestamp: Date.now() });
    await sleep(500); // Simulate long-running job
  });

  // Concurrency: parallel — multiple can run
  r.job("parallelJob", { trigger: { manual: true }, concurrency: "parallel" }, async (payload) => {
    jobLog.push({ name: "test.parallelJob", payload, timestamp: Date.now() });
  });

  // Concurrency: replace — cancel old, start new
  r.job("replaceJob", { trigger: { manual: true }, concurrency: "replace" }, async (payload) => {
    jobLog.push({ name: "test.replaceJob", payload, timestamp: Date.now() });
    await sleep(200);
  });

  // Concurrency: debounce — wait until quiet, then run once
  r.job(
    "debounceJob",
    { trigger: { manual: true }, concurrency: "debounce", debounceMs: 300 },
    async (payload) => {
      jobLog.push({ name: "test.debounceJob", payload, timestamp: Date.now() });
    },
  );

  // Job that fails
  r.job("failingJob", { trigger: { manual: true }, retries: 1 }, async () => {
    throw new Error("intentional failure");
  });
});

beforeAll(async () => {
  testRedis = await createTestRedis();
  redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
});

afterAll(async () => {
  await testRedis.cleanup();
});

// Helper to create a runner, run tests, then stop
async function withRunner(
  fn: (runner: JobRunner, registry: Registry) => Promise<void>,
): Promise<void> {
  const registry = createRegistry([testFeature]);
  const context: AppContext = {};
  const runner = createJobRunner({
    registry,
    context,
    redisUrl,
    queueName: `kumiko-test-${Date.now()}`,
  });

  try {
    await runner.start();
    await fn(runner, registry);
  } finally {
    await runner.stop();
  }
}

// --- Scenario 1: Boot job runs on startup ---

describe("scenario 1: boot job", () => {
  test("runOnBoot job executes when runner starts", async () => {
    clearLog();
    await withRunner(async () => {
      await waitFor(() => {
        const bootEntries = jobLog.filter((e) => e.name === "test.bootSync");
        expect(bootEntries.length).toBeGreaterThanOrEqual(1);
      });
    });
  });
});

// --- Scenario 2: Scheduled (cron) job ---

describe("scenario 2: scheduled job", () => {
  test("cron job is registered in registry", () => {
    const registry = createRegistry([testFeature]);
    const job = registry.getJob("test.scheduled");
    expect(job).toBeDefined();
    if (job && "cron" in job.trigger) {
      expect(job.trigger.cron).toBe("* * * * * *");
    } else {
      expect.unreachable("Expected cron trigger");
    }
  });

  test("cron job fires via BullMQ scheduler", async () => {
    clearLog();
    await withRunner(async () => {
      // BullMQ scheduler needs time to register the repeatable cron + first tick
      await waitFor(
        () => {
          const entries = jobLog.filter((e) => e.name === "test.scheduled");
          expect(entries.length).toBeGreaterThanOrEqual(1);
        },
        { delays: [2000, 2000, 2000, 2000] },
      );
    });
  });
});

// --- Scenario 3: Manual trigger ---

describe("scenario 3: manual trigger", () => {
  test("dispatch runs the job with payload", async () => {
    clearLog();
    await withRunner(async (runner) => {
      await runner.dispatch("test.manualReport", { reportId: 42 });
      await waitFor(() => {
        const entries = jobLog.filter((e) => e.name === "test.manualReport");
        expect(entries.length).toBe(1);
        expect(entries[0]?.payload).toEqual({ reportId: 42 });
      });
    });
  });

  test("dispatch unknown job throws", async () => {
    await withRunner(async (runner) => {
      await expect(runner.dispatch("nonexistent.job")).rejects.toThrow("Unknown job");
    });
  });
});

// --- Concurrency modes ---

describe("concurrency: parallel", () => {
  test("multiple parallel jobs all run", async () => {
    clearLog();
    await withRunner(async (runner) => {
      await runner.dispatch("test.parallelJob", { n: 1 });
      await runner.dispatch("test.parallelJob", { n: 2 });
      await runner.dispatch("test.parallelJob", { n: 3 });
      await waitFor(() => {
        const entries = jobLog.filter((e) => e.name === "test.parallelJob");
        expect(entries.length).toBe(3);
      });
    });
  });
});

describe("concurrency: skip", () => {
  test("skip mode prevents duplicate execution", async () => {
    clearLog();
    await withRunner(async (runner) => {
      // First job takes 500ms
      await runner.dispatch("test.skipJob", { n: 1 });

      // Try dispatching multiple times while first is running
      let skippedCount = 0;
      for (let i = 0; i < 5; i++) {
        await sleep(50);
        const id = await runner.dispatch("test.skipJob", { n: i + 2 });
        if (id === "skipped") skippedCount++;
      }

      await sleep(1000);

      // At least some should have been skipped
      expect(skippedCount).toBeGreaterThan(0);
      // Should not have run all 6 times
      const entries = jobLog.filter((e) => e.name === "test.skipJob");
      expect(entries.length).toBeLessThan(6);
    });
  });
});

describe("concurrency: debounce", () => {
  test("rapid dispatches result in fewer executions than dispatches", async () => {
    clearLog();
    await withRunner(async (runner) => {
      // Rapid fire 5 times — debounce should collapse some
      await runner.dispatch("test.debounceJob", { n: 1 });
      await runner.dispatch("test.debounceJob", { n: 2 });
      await runner.dispatch("test.debounceJob", { n: 3 });
      await runner.dispatch("test.debounceJob", { n: 4 });
      await runner.dispatch("test.debounceJob", { n: 5 });

      // Wait for debounce to settle + processing
      await sleep(1500);

      const entries = jobLog.filter((e) => e.name === "test.debounceJob");
      // Debounce should result in fewer executions than dispatches
      expect(entries.length).toBeLessThan(5);
      expect(entries.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// --- Error handling ---

describe("error handling", () => {
  test("failing job is caught, does not crash worker", async () => {
    clearLog();
    await withRunner(async (runner) => {
      const id = await runner.dispatch("test.failingJob");
      expect(id).toBeDefined();
      await sleep(500);

      // Worker should still be alive — dispatch another job
      await runner.dispatch("test.manualReport", { after: "failure" });
      await waitFor(() => {
        const entries = jobLog.filter((e) => e.name === "test.manualReport");
        expect(entries.length).toBeGreaterThanOrEqual(1);
      });
    });
  });
});

// --- Registry ---

describe("job registry", () => {
  test("getAllJobs returns all registered jobs with feature prefix", () => {
    const registry = createRegistry([testFeature]);
    const jobs = registry.getAllJobs();
    expect(jobs.has("test.bootSync")).toBe(true);
    expect(jobs.has("test.scheduled")).toBe(true);
    expect(jobs.has("test.manualReport")).toBe(true);
    expect(jobs.has("test.skipJob")).toBe(true);
  });

  test("getJob returns job definition", () => {
    const registry = createRegistry([testFeature]);
    const job = registry.getJob("test.skipJob");
    expect(job).toBeDefined();
    expect(job?.concurrency).toBe("skip");
  });

  test("boot job has runOnBoot flag", () => {
    const registry = createRegistry([testFeature]);
    const job = registry.getJob("test.bootSync");
    expect(job).toBeDefined();
    expect(job?.runOnBoot).toBe(true);
  });
});

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
    jobLog.push({ name: "test:job:boot-sync", payload, timestamp: Date.now() });
  });

  // Scenario 2: Scheduled job (cron every second for testing)
  r.job("scheduled", { trigger: { cron: "* * * * * *" } }, async (payload) => {
    jobLog.push({ name: "test:job:scheduled", payload, timestamp: Date.now() });
  });

  // Scenario 3: Manual trigger
  r.job("manualReport", { trigger: { manual: true } }, async (payload) => {
    jobLog.push({ name: "test:job:manual-report", payload, timestamp: Date.now() });
  });

  // Concurrency: skip — if running, skip new
  r.job("skipJob", { trigger: { manual: true }, concurrency: "skip" }, async (payload) => {
    jobLog.push({ name: "test:job:skip-job", payload, timestamp: Date.now() });
    await sleep(500); // Simulate long-running job
  });

  // Concurrency: parallel — multiple can run
  r.job("parallelJob", { trigger: { manual: true }, concurrency: "parallel" }, async (payload) => {
    jobLog.push({ name: "test:job:parallel-job", payload, timestamp: Date.now() });
  });

  // Concurrency: replace — cancel old, start new
  r.job("replaceJob", { trigger: { manual: true }, concurrency: "replace" }, async (payload) => {
    jobLog.push({ name: "test:job:replace-job", payload, timestamp: Date.now() });
    await sleep(200);
  });

  // Concurrency: debounce — wait until quiet, then run once
  r.job(
    "debounceJob",
    { trigger: { manual: true }, concurrency: "debounce", debounceMs: 300 },
    async (payload) => {
      jobLog.push({ name: "test:job:debounce-job", payload, timestamp: Date.now() });
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
  // Date.now() alone collided when two tests ran in the same millisecond;
  // adding a random suffix keeps queue names unique across the whole run.
  const queueName = `kumiko-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const runner = createJobRunner({
    registry,
    context,
    redisUrl,
    queueName,
  });

  try {
    await runner.start();
    await fn(runner, registry);
  } finally {
    await runner.stop();
    // Purge any lingering scheduler/repeat keys this queue left behind.
    // BullMQ stores them under <queueName>:* — orphaned schedulers from a
    // previous test run would otherwise fire into a now-stopped worker.
    const keys = await testRedis.redis.keys(`bull:${queueName}:*`);
    if (keys.length > 0) await testRedis.redis.del(...keys);
  }
}

// --- Scenario 1: Boot job runs on startup ---

describe("scenario 1: boot job", () => {
  test("runOnBoot job executes when runner starts", async () => {
    clearLog();
    await withRunner(async () => {
      await waitFor(() => {
        const bootEntries = jobLog.filter((e) => e.name === "test:job:boot-sync");
        expect(bootEntries.length).toBeGreaterThanOrEqual(1);
      });
    });
  });
});

// --- Scenario 2: Scheduled (cron) job ---

describe("scenario 2: scheduled job", () => {
  test("cron job is registered in registry", () => {
    const registry = createRegistry([testFeature]);
    const job = registry.getJob("test:job:scheduled");
    expect(job).toBeDefined();
    if (job && "cron" in job.trigger) {
      expect(job.trigger.cron).toBe("* * * * * *");
    } else {
      expect.unreachable("Expected cron trigger");
    }
  });

  // BullMQ's repeatable scheduler needs a second or two to register its
  // first tick — a generous delay schedule covers the startup window.
  test("cron job fires via BullMQ scheduler", { timeout: 15_000 }, async () => {
    clearLog();
    await withRunner(async () => {
      await waitFor(
        () => {
          const entries = jobLog.filter((e) => e.name === "test:job:scheduled");
          expect(entries.length).toBeGreaterThanOrEqual(1);
        },
        { delays: [2000, 3000, 5000] },
      );
    });
  });
});

// --- Scenario 3: Manual trigger ---

describe("scenario 3: manual trigger", () => {
  test("dispatch runs the job with payload", async () => {
    clearLog();
    await withRunner(async (runner) => {
      await runner.dispatch("test:job:manual-report", { reportId: 42 });
      await waitFor(() => {
        const entries = jobLog.filter((e) => e.name === "test:job:manual-report");
        expect(entries.length).toBe(1);
        expect(entries[0]?.payload).toEqual({ reportId: 42 });
      });
    });
  });

  test("dispatch unknown job throws", async () => {
    await withRunner(async (runner) => {
      await expect(runner.dispatch("nonexistent:job:missing")).rejects.toThrow("Unknown job");
    });
  });
});

// --- Concurrency modes ---

describe("concurrency: parallel", () => {
  test("multiple parallel jobs all run", async () => {
    clearLog();
    await withRunner(async (runner) => {
      await runner.dispatch("test:job:parallel-job", { n: 1 });
      await runner.dispatch("test:job:parallel-job", { n: 2 });
      await runner.dispatch("test:job:parallel-job", { n: 3 });
      await waitFor(() => {
        const entries = jobLog.filter((e) => e.name === "test:job:parallel-job");
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
      await runner.dispatch("test:job:skip-job", { n: 1 });

      // Try dispatching multiple times while first is running
      let skippedCount = 0;
      for (let i = 0; i < 5; i++) {
        await sleep(50);
        const id = await runner.dispatch("test:job:skip-job", { n: i + 2 });
        if (id === "skipped") skippedCount++;
      }

      // Wait until the first (running) job finishes so its log entry lands.
      // Skip-mode guarantees max one job at a time, so we only ever need to
      // see a single entry to know the run settled.
      await waitFor(() => {
        const entries = jobLog.filter((e) => e.name === "test:job:skip-job");
        expect(entries.length).toBeGreaterThanOrEqual(1);
      });

      // At least some should have been skipped
      expect(skippedCount).toBeGreaterThan(0);
      // Should not have run all 6 times
      const entries = jobLog.filter((e) => e.name === "test:job:skip-job");
      expect(entries.length).toBeLessThan(6);
    });
  });
});

describe("concurrency: debounce", () => {
  test("rapid dispatches result in fewer executions than dispatches", async () => {
    clearLog();
    await withRunner(async (runner) => {
      // Rapid fire 5 times — debounce should collapse some
      await runner.dispatch("test:job:debounce-job", { n: 1 });
      await runner.dispatch("test:job:debounce-job", { n: 2 });
      await runner.dispatch("test:job:debounce-job", { n: 3 });
      await runner.dispatch("test:job:debounce-job", { n: 4 });
      await runner.dispatch("test:job:debounce-job", { n: 5 });

      // Debounce (300ms) fires after the last rapid dispatch, then BullMQ
      // picks the job up — first successful poll usually lands around 500ms.
      await waitFor(
        () => {
          const entries = jobLog.filter((e) => e.name === "test:job:debounce-job");
          expect(entries.length).toBeGreaterThanOrEqual(1);
        },
        { delays: [500, 1000, 2000] },
      );

      const entries = jobLog.filter((e) => e.name === "test:job:debounce-job");
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
      const id = await runner.dispatch("test:job:failing-job");
      expect(id).toBeDefined();

      // No fixed sleep needed — the follow-up dispatch + waitFor below prove
      // the worker is still alive. If the failing job had crashed the worker,
      // the manual-report would never land and waitFor would time out.
      await runner.dispatch("test:job:manual-report", { after: "failure" });
      await waitFor(() => {
        const entries = jobLog.filter((e) => e.name === "test:job:manual-report");
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
    expect(jobs.has("test:job:boot-sync")).toBe(true);
    expect(jobs.has("test:job:scheduled")).toBe(true);
    expect(jobs.has("test:job:manual-report")).toBe(true);
    expect(jobs.has("test:job:skip-job")).toBe(true);
  });

  test("getJob returns job definition", () => {
    const registry = createRegistry([testFeature]);
    const job = registry.getJob("test:job:skip-job");
    expect(job).toBeDefined();
    expect(job?.concurrency).toBe("skip");
  });

  test("boot job has runOnBoot flag", () => {
    const registry = createRegistry([testFeature]);
    const job = registry.getJob("test:job:boot-sync");
    expect(job).toBeDefined();
    expect(job?.runOnBoot).toBe(true);
  });
});

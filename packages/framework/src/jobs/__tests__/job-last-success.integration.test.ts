import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildServer } from "../../api/server";
import { createRegistry, defineFeature } from "../../engine";
import type { AppContext, Registry } from "../../engine/types";
import {
  createNoopProvider,
  createPrometheusMeter,
  registerStandardMetrics,
} from "../../observability";
import { createTestRedis, type TestRedis } from "../../stack";
import { waitFor } from "../../testing";
import { createJobRunner } from "../job-runner";

const JWT = "job-last-success-test-secret-minimum-32-chars!!";
const SUCCEEDS = "liveness:job:succeeds";
const FAILS = "liveness:job:fails-always";

let testRedis: TestRedis;
let redisUrl: string;

const livenessFeature = defineFeature("liveness", (r) => {
  r.job("succeeds", { trigger: { manual: true } }, async () => {});
  r.job("failsAlways", { trigger: { manual: true } }, async () => {
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

function slotFor(meter: ReturnType<typeof createPrometheusMeter>, job: string) {
  return meter
    .snapshot()
    .get("kumiko_job_last_success_timestamp_seconds")
    ?.slots.find((s) => s.labels?.["job"] === job);
}

async function withRunner(
  meter: ReturnType<typeof createPrometheusMeter>,
  fn: (runner: ReturnType<typeof createJobRunner>, failures: string[]) => Promise<void>,
): Promise<void> {
  const registry: Registry = createRegistry([livenessFeature]);
  const context: AppContext = { meter };
  const failures: string[] = [];
  const queueNamePrefix = `kumiko-test-ls-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const runner = createJobRunner({
    registry,
    context,
    redisUrl,
    consumerLane: "worker",
    queueNamePrefix,
    onJobFailed: (jobName) => {
      failures.push(jobName);
    },
  });
  await runner.start();
  try {
    await fn(runner, failures);
  } finally {
    await runner.stop();
    const keys = await testRedis.redis.keys(`bull:${queueNamePrefix}-worker:*`);
    if (keys.length > 0) await testRedis.redis.del(...keys);
  }
}

describe("job-runner — kumiko_job_last_success_timestamp_seconds", () => {
  test("a successful run stamps the gauge, a failing run leaves no series", async () => {
    const meter = createPrometheusMeter();
    registerStandardMetrics(meter);

    await withRunner(meter, async (runner, failures) => {
      const before = Date.now() / 1000;
      await runner.dispatch(SUCCEEDS, {});
      await waitFor(() => slotFor(meter, SUCCEEDS) !== undefined);

      const stamped = slotFor(meter, SUCCEEDS) as { value: number };
      expect(stamped.value).toBeGreaterThanOrEqual(before);
      expect(stamped.value).toBeLessThanOrEqual(Date.now() / 1000 + 1);

      // Separate job name, so the "failure must not stamp" assertion cannot
      // pass just because a prior success left a value inside the same second.
      await runner.dispatch(FAILS, {});
      await waitFor(() => failures.includes(FAILS));
      expect(slotFor(meter, FAILS)).toBeUndefined();
    });
  });

  test("a later success advances the stamp", async () => {
    const meter = createPrometheusMeter();
    registerStandardMetrics(meter);

    await withRunner(meter, async (runner) => {
      await runner.dispatch(SUCCEEDS, {});
      await waitFor(() => slotFor(meter, SUCCEEDS) !== undefined);
      const first = (slotFor(meter, SUCCEEDS) as { value: number }).value;

      await runner.dispatch(SUCCEEDS, {});
      await waitFor(() => (slotFor(meter, SUCCEEDS) as { value: number }).value > first, {
        delays: [250, 1000, 3000],
      });
    });
  });

  test("the stamp reaches the real /metrics scrape output", async () => {
    const meter = createPrometheusMeter();
    registerStandardMetrics(meter);

    await withRunner(meter, async (runner) => {
      await runner.dispatch(SUCCEEDS, {});
      await waitFor(() => slotFor(meter, SUCCEEDS) !== undefined);

      // Same meter instance the runner wrote into — that sharing is what
      // buildServer + job-runner do in a real process (fw#1046).
      const { app } = buildServer({
        registry: createRegistry([livenessFeature]),
        context: {},
        jwtSecret: JWT,
        observability: { ...createNoopProvider(), meter },
        metrics: {},
      });
      const res = await app.request("/metrics");
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("# TYPE kumiko_job_last_success_timestamp_seconds gauge");
      expect(body).toContain(`kumiko_job_last_success_timestamp_seconds{job="${SUCCEEDS}"} `);
    });
  });
});

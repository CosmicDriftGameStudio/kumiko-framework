import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildServer } from "../../api/server.js";
import { createRegistry, defineFeature } from "../../engine/index.js";
import type { TenantId } from "../../engine/types/identifiers.js";
import type { AppContext, Registry } from "../../engine/types/index.js";
import {
  createNoopProvider,
  createPrometheusMeter,
  registerStandardMetrics,
} from "../../observability/index.js";
import { createTestRedis, type TestRedis } from "../../stack/index.js";
import { waitFor } from "../../testing/index.js";
import { createJobRunner, type JobRunnerOptions } from "../job-runner.js";

const JWT = "job-last-success-test-secret-minimum-32-chars!!";
const SUCCEEDS = "liveness:job:succeeds";
const FAILS = "liveness:job:fails-always";
const FANS_OUT = "liveness:job:fans-out";
const COMPLETE_HOOK_THROWS = "liveness:job:complete-hook-throws";
const TENANTS = ["ls-tenant-a", "ls-tenant-b"] as TenantId[]; // @cast-boundary test fixture — TenantId is a branded string

let testRedis: TestRedis;
let redisUrl: string;

const livenessFeature = defineFeature("liveness", (r) => {
  r.job("succeeds", { trigger: { manual: true } }, async () => {});
  r.job("failsAlways", { trigger: { manual: true } }, async () => {
    throw new Error("intentional failure");
  });
  r.job("fansOut", { trigger: { manual: true }, perTenant: true }, async () => {});
  r.job("completeHookThrows", { trigger: { manual: true } }, async () => {});
});

beforeAll(async () => {
  testRedis = await createTestRedis();
  redisUrl = `redis://${testRedis.redis.options.host}:${testRedis.redis.options.port}/${testRedis.redis.options.db}`;
});

afterAll(async () => {
  await testRedis.cleanup();
});

function stampSlots(meter: ReturnType<typeof createPrometheusMeter>) {
  return meter.snapshot().get("kumiko_job_last_success_timestamp_seconds")?.slots ?? [];
}

function stampFor(
  meter: ReturnType<typeof createPrometheusMeter>,
  job: string,
): number | undefined {
  const slot = stampSlots(meter).find((s) => s.labels?.["job"] === job);
  return slot !== undefined && "value" in slot ? slot.value : undefined;
}

async function withRunner(
  meter: ReturnType<typeof createPrometheusMeter>,
  fn: (runner: ReturnType<typeof createJobRunner>, failures: string[]) => Promise<void>,
  runnerOptions: Pick<JobRunnerOptions, "onJobComplete" | "getActiveTenantIds"> = {},
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
    ...runnerOptions,
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
      await waitFor(() => stampFor(meter, SUCCEEDS) !== undefined);

      const stamped = stampFor(meter, SUCCEEDS);
      expect(stamped).toBeGreaterThanOrEqual(before);
      expect(stamped).toBeLessThanOrEqual(Date.now() / 1000 + 1);

      // Separate job name, so the "failure must not stamp" assertion cannot
      // pass just because a prior success left a value inside the same second.
      await runner.dispatch(FAILS, {});
      await waitFor(() => failures.includes(FAILS));
      expect(stampFor(meter, FAILS)).toBeUndefined();
    });
  });

  test("a later success advances the stamp", async () => {
    const meter = createPrometheusMeter();
    registerStandardMetrics(meter);

    await withRunner(meter, async (runner) => {
      await runner.dispatch(SUCCEEDS, {});
      await waitFor(() => stampFor(meter, SUCCEEDS) !== undefined);
      const first = stampFor(meter, SUCCEEDS) ?? 0;

      await runner.dispatch(SUCCEEDS, {});
      await waitFor(() => (stampFor(meter, SUCCEEDS) ?? 0) > first, {
        delays: [250, 1000, 3000],
      });
      expect(stampFor(meter, SUCCEEDS)).toBeGreaterThan(first);
    });
  });

  test("a throwing onJobComplete leaves the stamp of the run that succeeded", async () => {
    const meter = createPrometheusMeter();
    registerStandardMetrics(meter);

    await withRunner(
      meter,
      async (runner, failures) => {
        await runner.dispatch(COMPLETE_HOOK_THROWS, {});
        await waitFor(() => failures.includes(COMPLETE_HOOK_THROWS));
        expect(stampFor(meter, COMPLETE_HOOK_THROWS)).toBeGreaterThan(0);
      },
      {
        onJobComplete: () => {
          throw new Error("observer hook failure");
        },
      },
    );
  });

  test("a perTenant job stamps under its own name through the children, never under the wrapper", async () => {
    const meter = createPrometheusMeter();
    registerStandardMetrics(meter);
    let completedChildren = 0;

    await withRunner(
      meter,
      async (runner) => {
        await runner.dispatch(FANS_OUT, {});
        await waitFor(() => completedChildren === TENANTS.length);

        expect(stampSlots(meter).map((s) => s.labels?.["job"])).toEqual([FANS_OUT]);
      },
      {
        getActiveTenantIds: async () => TENANTS,
        onJobComplete: () => {
          completedChildren += 1;
        },
      },
    );
  });

  test("the stamp reaches the real /metrics scrape output", async () => {
    const meter = createPrometheusMeter();
    registerStandardMetrics(meter);

    await withRunner(meter, async (runner) => {
      await runner.dispatch(SUCCEEDS, {});
      await waitFor(() => stampFor(meter, SUCCEEDS) !== undefined);

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

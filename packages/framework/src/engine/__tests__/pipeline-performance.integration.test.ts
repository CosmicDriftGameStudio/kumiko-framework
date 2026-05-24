// Pipeline-engine performance smoke-test.
//
// Compares the M.1 pipeline-form handler ({ perform: pipeline(...) })
// against the equivalent free-form handler ({ handler: async (...) })
// over N identical writes against the real Postgres stack. The point
// is NOT to optimise — the pipeline-form is a thin wrapper, not a
// hot-path engine. The point is to lock in a baseline so a future
// regression (e.g. an O(N²) walkAllSteps refactor) shows up as a
// visible delta rather than as silently-degraded latency.
//
// Bar: pipeline-form mean+p95 latency must stay within 3× free-form.
// Anything beyond that is either a real perf bug or a load-flake worth
// inspecting. The test logs the actual numbers (bun test stdout) so
// the baseline is visible in CI without re-running locally.
//
// Scope caveat: this measures dispatcher + handler-form combined over
// a SINGLE-step handler (just r.step.return). The dispatcher dominates
// the wall-time, which is what makes the bar useful — a real per-step
// regression would have to be massive to show up. To isolate per-step
// overhead specifically, you'd want a 5+-step handler so the per-step
// cost has room to accumulate. Out of scope for the M.1 prod-ready
// gate; if a future regression suspect needs that breakdown, extend
// here with a longer-pipeline handler variant.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { setupTestStack, type TestStack, TestUsers, unsafeCreateEntityTable } from "../../stack";
import { defineFeature } from "../define-feature";
import { defineWriteHandler } from "../define-handler";
import { createEntity, createNumberField, createTextField } from "../factories";
import { pipeline } from "../pipeline";

// Same logical operation in both handler-forms: read input, return a
// trivial transformed payload. No DB-write — the goal is to compare
// the handler-invocation pipeline overhead, not Postgres write latency
// (the latter would dominate any real-world handler comparison and
// hide whatever overhead the step-engine adds).
const trivialSchema = z.object({ n: z.number() });

const trivialPipeline = defineWriteHandler({
  name: "trivial:pipeline",
  schema: trivialSchema,
  access: { roles: ["Admin"] },
  perform: pipeline<{ n: number }, { doubled: number }>(({ event, r }) => [
    r.step.return(() => ({
      isSuccess: true as const,
      data: { doubled: event.payload.n * 2 },
    })),
  ]),
});

const trivialFreeform = defineWriteHandler({
  name: "trivial:freeform",
  schema: trivialSchema,
  access: { roles: ["Admin"] },
  handler: async (event) => ({
    isSuccess: true as const,
    data: { doubled: event.payload.n * 2 },
  }),
});

const productEntity = createEntity({
  table: "perf_smoke_products",
  fields: {
    sku: createTextField({ required: true }),
    qty: createNumberField({ default: 0 }),
  },
});

const perfFeature = defineFeature("perftest", (r) => {
  // Entity-registration is needed so the dispatcher boots cleanly even
  // though the trivial handlers don't touch it; without an entity, the
  // feature is empty enough that some boot-validators short-circuit.
  r.entity("perf-product", productEntity);
  r.writeHandler(trivialPipeline);
  r.writeHandler(trivialFreeform);
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [perfFeature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, productEntity, "perf-product");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.redis.flushNamespace();
});

// Sample size: 100 calls per form keeps the test under ~5s even on a
// loaded laptop. Higher N gives tighter percentiles but costs wall-time
// in CI. The signal we need (within-3× ratio) shows up at N=100.
const N = 100;

async function timeMany(call: () => Promise<unknown>): Promise<number[]> {
  const samples: number[] = [];
  for (let i = 0; i < N; i++) {
    const start = performance.now();
    await call();
    samples.push(performance.now() - start);
  }
  return samples;
}

function summarise(samples: number[]): { mean: number; p50: number; p95: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = sorted.reduce((acc, v) => acc + v, 0) / sorted.length;
  const p50Idx = Math.floor(sorted.length * 0.5);
  const p95Idx = Math.floor(sorted.length * 0.95);
  // Non-null: sorted has length N (≥1) and indices are clamped < N.
  const p50 = sorted[p50Idx]!;
  const p95 = sorted[p95Idx]!;
  return { mean, p50, p95 };
}

describe("pipeline-engine performance smoke-test", () => {
  test(`pipeline-form latency stays within 3× free-form (N=${N})`, async () => {
    // Warmup: 10 calls per form to amortise JIT + Postgres connection-
    // pool warmup, otherwise the first samples dominate the percentiles.
    for (let i = 0; i < 10; i++) {
      await stack.http.writeOk("perftest:write:trivial:pipeline", { n: i }, TestUsers.admin);
      await stack.http.writeOk("perftest:write:trivial:freeform", { n: i }, TestUsers.admin);
    }

    const pipelineSamples = await timeMany(() =>
      stack.http.writeOk("perftest:write:trivial:pipeline", { n: 1 }, TestUsers.admin),
    );
    const freeformSamples = await timeMany(() =>
      stack.http.writeOk("perftest:write:trivial:freeform", { n: 1 }, TestUsers.admin),
    );

    const pipelineStats = summarise(pipelineSamples);
    const freeformStats = summarise(freeformSamples);

    // eslint-disable-next-line no-console -- observable baseline for CI logs
    console.log(
      `[perf] pipeline mean=${pipelineStats.mean.toFixed(2)}ms p50=${pipelineStats.p50.toFixed(2)}ms p95=${pipelineStats.p95.toFixed(2)}ms | ` +
        `freeform mean=${freeformStats.mean.toFixed(2)}ms p50=${freeformStats.p50.toFixed(2)}ms p95=${freeformStats.p95.toFixed(2)}ms | ` +
        `ratio mean=${(pipelineStats.mean / freeformStats.mean).toFixed(2)}× p95=${(pipelineStats.p95 / freeformStats.p95).toFixed(2)}×`,
    );

    // Assert: the pipeline-form must not be more than 3× slower than
    // free-form on the mean. Higher → suspect a real perf regression.
    // p95-ratio is logged but NOT asserted — tail-latency on a loaded
    // CI runner is too noisy for a hard threshold.
    expect(pipelineStats.mean).toBeLessThan(freeformStats.mean * 3);
  });
});

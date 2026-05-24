// Pipeline-engine observability integration test.
//
// Verifies that step.run sees a working ctx.tracer + ctx.metrics —
// not the noop provider — and that any spans/metrics emitted inside
// a step land in the same recording provider that the dispatcher
// uses for its own spans.
//
// Why this is a prod-readiness check, not a "nice-to-have": handlers
// without observability are invisible in prod. The dispatcher already
// emits a `write.handler` span around every handler invocation; the
// pipeline-runner runs INSIDE that span. If the pipeline-runner
// accidentally substituted a noop tracer (or stripped the ctx field),
// every step inside a pipeline-form handler would be untraceable —
// and we wouldn't notice until a prod incident lacks the breadcrumbs.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { TestUsers, unsafeCreateEntityTable } from "../../stack";
import { setupBunTestStack, type BunTestStack } from "../../bun-db/__tests__/bun-test-stack";
import { createRecordingProvider, type RecordingProvider } from "../../testing";
import { defineFeature } from "../define-feature";
import { defineWriteHandler } from "../define-handler";
import { createEntity, createTextField } from "../factories";
import { pipeline } from "../pipeline";

// Handler whose step bodies emit a span + a metric. The recording
// provider afterwards lets us assert both landed.
const observedSchema = z.object({});

const observedHandler = defineWriteHandler({
  name: "observed",
  schema: observedSchema,
  access: { roles: ["Admin"] },
  perform: pipeline<Record<string, never>, { ok: true }>(({ r }) => [
    r.step.compute("traced", (ctx) => {
      // Span emitted from inside a step. End it explicitly because
      // step.run is sync-or-async-but-not-otel-instrumented; the
      // recording provider only persists spans on .end().
      const span = ctx.tracer.startSpan("test:step.compute.traced");
      span.end();
      return null;
    }),
    r.step.compute("metered", (ctx) => {
      // Note: MetricsHandle.inc is (name, labels?, value?) — labels comes
      // BEFORE value. Argument order trips a lot of authors; the engine-
      // wide convention follows the OpenTelemetry meter shape.
      ctx.metrics.inc("test_step_counter_total", { step_name: "metered" }, 1);
      return null;
    }),
    r.step.return({ isSuccess: true as const, data: { ok: true } }),
  ]),
});

const obsEntity = createEntity({
  table: "obs_smoke_things",
  fields: { label: createTextField({ required: true }) },
});

const obsFeature = defineFeature("obstest", (r) => {
  r.entity("obs-thing", obsEntity);
  // Pre-register the counter the step body emits — feature-scoped
  // metric names get a `kumiko_<feature>_` prefix at boot.
  r.metric("test_step_counter_total", {
    type: "counter",
    labels: ["step_name"],
  });
  r.writeHandler(observedHandler);
});

let stack: BunTestStack;
let provider: RecordingProvider;

beforeAll(async () => {
  provider = createRecordingProvider();
  stack = await setupBunTestStack({
    features: [obsFeature],
    systemHooks: [],
    observability: provider,
  });
  await unsafeCreateEntityTable(stack.db, obsEntity, "obs-thing");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  provider.reset();
  await stack.redis.flushNamespace();
});

describe("pipeline-engine observability inheritance", () => {
  test("ctx.tracer.startSpan inside a step is recorded by the dispatcher's provider", async () => {
    await stack.http.writeOk("obstest:write:observed", {}, TestUsers.admin);

    const stepSpans = provider.spansByName("test:step.compute.traced");
    expect(stepSpans).toHaveLength(1);

    // Sanity: the dispatcher's own span exists too — confirms the
    // step-span isn't somehow replacing it.
    const writeHandlerSpans = provider.spans.filter((s) => s.name.includes("handler"));
    expect(writeHandlerSpans.length).toBeGreaterThan(0);
  });

  test("ctx.metrics.inc inside a step lands in the dispatcher's metric stream", async () => {
    await stack.http.writeOk("obstest:write:observed", {}, TestUsers.admin);

    // Feature-scoped metric names get a `kumiko_<feature>_` prefix at boot.
    const stepMetrics = provider.metricEvents.filter(
      (m) => m.name === "kumiko_obstest_test_step_counter_total",
    );
    expect(stepMetrics).toHaveLength(1);
    expect(stepMetrics[0]).toMatchObject({
      type: "counter.inc",
      name: "kumiko_obstest_test_step_counter_total",
      value: 1,
      labels: { step_name: "metered" },
    });
  });

  test("step-emitted spans are explicit children of the dispatcher's handler span", async () => {
    // Trace-correlation: a span emitted from inside step.run must
    // belong to the same trace as the dispatcher's outer handler
    // span AND be a child of it (parentSpanId resolves to a span
    // whose name contains "handler"). The earlier weaker assertion
    // (sameTrace.length > 1) would have passed even if a future
    // regression gave step-spans a fresh traceId — multiple spans
    // in the same trace can be coincidence.
    await stack.http.writeOk("obstest:write:observed", {}, TestUsers.admin);

    const stepSpan = provider.spansByName("test:step.compute.traced")[0];
    expect(stepSpan).toBeDefined();
    expect(stepSpan!.parentSpanId).toBeDefined();

    // Resolve the parent span explicitly — it must exist within the
    // same trace AND name a handler-related concept.
    const parent = provider
      .spansByTraceId(stepSpan!.traceId)
      .find((s) => s.spanId === stepSpan!.parentSpanId);
    expect(parent).toBeDefined();
    expect(parent!.name).toMatch(/handler/);
  });
});

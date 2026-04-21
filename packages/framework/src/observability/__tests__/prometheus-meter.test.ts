import { describe, expect, test } from "vitest";
import { createPrometheusMeter, serializeOpenMetrics } from "../prometheus-meter";

describe("PrometheusMeter — accumulation", () => {
  test("counter: inc across multiple calls sums into a single slot", () => {
    const meter = createPrometheusMeter();
    meter.registerMetric({
      name: "kumiko_test_total",
      type: "counter",
      description: "test counter",
    });
    meter.counter("kumiko_test_total").inc();
    meter.counter("kumiko_test_total").inc(4);
    meter.counter("kumiko_test_total").inc(0.5);

    const out = serializeOpenMetrics(meter);
    expect(out).toContain("# TYPE kumiko_test_total counter");
    expect(out).toContain("kumiko_test_total 5.5");
  });

  test("counter: different labelsets accumulate independently", () => {
    const meter = createPrometheusMeter();
    meter.registerMetric({
      name: "kumiko_http_requests_total",
      type: "counter",
      labels: ["method", "status"],
    });
    const c = meter.counter("kumiko_http_requests_total");
    c.inc(1, { method: "GET", status: "200" });
    c.inc(1, { method: "GET", status: "200" });
    c.inc(1, { method: "POST", status: "201" });

    const out = serializeOpenMetrics(meter);
    expect(out).toContain(`kumiko_http_requests_total{method="GET",status="200"} 2`);
    expect(out).toContain(`kumiko_http_requests_total{method="POST",status="201"} 1`);
  });

  test("gauge: set overrides, inc/dec relative", () => {
    const meter = createPrometheusMeter();
    meter.registerMetric({ name: "kumiko_queue_depth", type: "gauge" });
    const g = meter.gauge("kumiko_queue_depth");
    g.set(10);
    g.inc(5);
    g.dec(3);
    expect(serializeOpenMetrics(meter)).toContain("kumiko_queue_depth 12");

    g.set(0);
    expect(serializeOpenMetrics(meter)).toContain("kumiko_queue_depth 0");
  });

  test("histogram: cumulative buckets + sum + count, +Inf terminator", () => {
    const meter = createPrometheusMeter();
    meter.registerMetric({
      name: "kumiko_latency_seconds",
      type: "histogram",
      buckets: [0.01, 0.1, 1],
    });
    const h = meter.histogram("kumiko_latency_seconds");
    h.observe(0.005); // hits 0.01, 0.1, 1
    h.observe(0.5); // hits 1 only
    h.observe(2); // hits nothing but count

    const out = serializeOpenMetrics(meter);
    expect(out).toContain(`kumiko_latency_seconds_bucket{le="0.01"} 1`);
    expect(out).toContain(`kumiko_latency_seconds_bucket{le="0.1"} 1`);
    expect(out).toContain(`kumiko_latency_seconds_bucket{le="1"} 2`);
    expect(out).toContain(`kumiko_latency_seconds_bucket{le="+Inf"} 3`);
    expect(out).toContain(`kumiko_latency_seconds_sum 2.505`);
    expect(out).toContain(`kumiko_latency_seconds_count 3`);
  });
});

describe("serializeOpenMetrics — format invariants", () => {
  test("output ends with # EOF + newline (OpenMetrics spec)", () => {
    const meter = createPrometheusMeter();
    meter.registerMetric({ name: "kumiko_noop", type: "counter" });
    const out = serializeOpenMetrics(meter);
    expect(out.endsWith("# EOF\n")).toBe(true);
  });

  test("HELP line emitted when description is set, skipped otherwise", () => {
    const meter = createPrometheusMeter();
    meter.registerMetric({
      name: "kumiko_with_help",
      type: "counter",
      description: "documented",
    });
    meter.registerMetric({ name: "kumiko_no_help", type: "counter" });

    const out = serializeOpenMetrics(meter);
    expect(out).toContain("# HELP kumiko_with_help documented");
    expect(out).not.toContain("# HELP kumiko_no_help");
  });

  test("labels get quoted, escape special chars (backslash, quote, newline)", () => {
    const meter = createPrometheusMeter();
    meter.registerMetric({
      name: "kumiko_log",
      type: "counter",
      labels: ["msg"],
    });
    meter.counter("kumiko_log").inc(1, { msg: 'she said "hi"\nback\\slash' });
    const out = serializeOpenMetrics(meter);
    expect(out).toContain(`kumiko_log{msg="she said \\"hi\\"\\nback\\\\slash"} 1`);
  });

  test("label keys are sorted alphabetically for deterministic output", () => {
    const meter = createPrometheusMeter();
    meter.registerMetric({
      name: "kumiko_req",
      type: "counter",
      labels: ["zulu", "alpha", "mike"],
    });
    meter.counter("kumiko_req").inc(1, { zulu: "z", alpha: "a", mike: "m" });
    const out = serializeOpenMetrics(meter);
    expect(out).toContain(`kumiko_req{alpha="a",mike="m",zulu="z"} 1`);
  });

  test("metric names sorted alphabetically across the output", () => {
    const meter = createPrometheusMeter();
    meter.registerMetric({ name: "kumiko_zebra", type: "counter" });
    meter.registerMetric({ name: "kumiko_apple", type: "counter" });
    meter.counter("kumiko_zebra").inc();
    meter.counter("kumiko_apple").inc();
    const out = serializeOpenMetrics(meter);
    expect(out.indexOf("kumiko_apple")).toBeLessThan(out.indexOf("kumiko_zebra"));
  });
});

describe("PrometheusMeter — registration guards", () => {
  test("duplicate name throws", () => {
    const meter = createPrometheusMeter();
    meter.registerMetric({ name: "kumiko_dup", type: "counter" });
    expect(() => meter.registerMetric({ name: "kumiko_dup", type: "gauge" })).toThrow(
      /already registered/i,
    );
  });

  test("accessor with wrong type throws", () => {
    const meter = createPrometheusMeter();
    meter.registerMetric({ name: "kumiko_c", type: "counter" });
    expect(() => meter.gauge("kumiko_c")).toThrow(/not registered or wrong type/i);
  });
});

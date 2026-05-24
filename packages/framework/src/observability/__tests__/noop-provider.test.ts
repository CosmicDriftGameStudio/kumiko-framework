import { describe, expect, it } from "bun:test";
import { createNoopProvider } from "../noop-provider";

describe("NoopProvider", () => {
  it("provides noop tracer with startSpan", () => {
    const p = createNoopProvider();
    const span = p.tracer.startSpan("test");
    expect(span.name).toBe("test");
    expect(span.traceId).toBe("");
    expect(span.ended).toBe(false);
    span.setAttribute("foo", "bar");
    span.end();
    expect(span.ended).toBe(true);
  });

  it("withSpan runs fn and returns its value", async () => {
    const p = createNoopProvider();
    const result = await p.tracer.withSpan("op", async (span) => {
      expect(span.name).toBe("op");
      return 42;
    });
    expect(result).toBe(42);
  });

  it("withSpan ends span on thrown error", async () => {
    const p = createNoopProvider();
    let capturedSpan: { ended: boolean } | undefined;
    await expect(
      p.tracer.withSpan("boom", async (span) => {
        capturedSpan = span;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(capturedSpan?.ended).toBe(true);
  });

  it("getActiveSpan returns undefined (noop doesn't propagate)", () => {
    const p = createNoopProvider();
    expect(p.tracer.getActiveSpan()).toBeUndefined();
  });

  it("registerMetric rejects duplicates", () => {
    const p = createNoopProvider();
    p.meter.registerMetric({
      name: "kumiko_test_total",
      type: "counter",
    });
    expect(() =>
      p.meter.registerMetric({
        name: "kumiko_test_total",
        type: "counter",
      }),
    ).toThrow(/already registered/);
  });

  it("meter returns typed handles for registered metrics", () => {
    const p = createNoopProvider();
    p.meter.registerMetric({ name: "kumiko_test_total", type: "counter" });
    p.meter.registerMetric({ name: "kumiko_test_duration_seconds", type: "histogram" });
    p.meter.registerMetric({ name: "kumiko_test_pool", type: "gauge" });

    expect(() => p.meter.counter("kumiko_test_total").inc()).not.toThrow();
    expect(() => p.meter.histogram("kumiko_test_duration_seconds").observe(0.5)).not.toThrow();
    expect(() => p.meter.gauge("kumiko_test_pool").set(10)).not.toThrow();
  });

  it("meter rejects wrong type lookup", () => {
    const p = createNoopProvider();
    p.meter.registerMetric({ name: "kumiko_test_total", type: "counter" });
    expect(() => p.meter.histogram("kumiko_test_total")).toThrow(/not registered or wrong type/);
  });

  it("meter rejects unknown metric", () => {
    const p = createNoopProvider();
    expect(() => p.meter.counter("kumiko_nothing_total")).toThrow(/not registered/);
  });

  it("shutdown resolves", async () => {
    const p = createNoopProvider();
    await expect(p.shutdown()).resolves.toBeUndefined();
  });
});

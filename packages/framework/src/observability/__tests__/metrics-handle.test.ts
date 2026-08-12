import { describe, expect, it } from "bun:test";
import { createMetricsHandle, createSafeMetricsHandle } from "../metrics-handle";
import { type MetricEvent, RecordingMeter } from "../recording-meter";

function makeMeter() {
  const events: MetricEvent[] = [];
  const meter = new RecordingMeter((e) => events.push(e));
  return { meter, events };
}

describe("createMetricsHandle", () => {
  it("resolves the short name against the feature and forwards to the meter", () => {
    const { meter, events } = makeMeter();
    meter.registerMetric({ name: "kumiko_orders_created_total", type: "counter" });
    createMetricsHandle(meter, "orders").inc("created_total");
    expect(events).toEqual([
      { type: "counter.inc", name: "kumiko_orders_created_total", value: 1, labels: undefined },
    ]);
  });

  it("throws on an unregistered metric by default", () => {
    const { meter } = makeMeter();
    expect(() => createMetricsHandle(meter, "orders").inc("nope")).toThrow();
  });
});

describe("createSafeMetricsHandle", () => {
  it("silently no-ops on an unregistered metric instead of throwing", () => {
    const { meter, events } = makeMeter();
    expect(() => createSafeMetricsHandle(meter, "orders").inc("nope")).not.toThrow();
    expect(events).toEqual([]);
  });

  it("still forwards to the meter once the metric is registered", () => {
    const { meter, events } = makeMeter();
    meter.registerMetric({ name: "kumiko_orders_created_total", type: "counter" });
    createSafeMetricsHandle(meter, "orders").inc("created_total");
    expect(events).toEqual([
      { type: "counter.inc", name: "kumiko_orders_created_total", value: 1, labels: undefined },
    ]);
  });
});

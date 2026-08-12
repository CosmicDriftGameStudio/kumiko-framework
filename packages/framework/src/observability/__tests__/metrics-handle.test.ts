import { describe, expect, it } from "bun:test";
import { createSafeMetricsHandle } from "../metrics-handle";
import { RecordingMeter } from "../recording-meter";

describe("createSafeMetricsHandle", () => {
  it("an invalid featureName is a no-op, not a throw", () => {
    const meter = new RecordingMeter(() => {});
    const handle = createSafeMetricsHandle(meter, "Not Kebab Case!");
    expect(() => handle.inc("created_total")).not.toThrow();
    expect(() => handle.observe("duration_seconds", 1)).not.toThrow();
    expect(() => handle.set("active", 1)).not.toThrow();
  });

  it("an unregistered metric name is a no-op, not a throw", () => {
    const meter = new RecordingMeter(() => {});
    const handle = createSafeMetricsHandle(meter, "orders");
    expect(() => handle.inc("not_registered_total")).not.toThrow();
  });

  it("a registered metric on a valid featureName still records", () => {
    const events: unknown[] = [];
    const meter = new RecordingMeter((e) => events.push(e));
    meter.registerMetric({ name: "kumiko_orders_created_total", type: "counter" });
    const handle = createSafeMetricsHandle(meter, "orders");
    handle.inc("created_total");
    expect(events).toEqual([
      { type: "counter.inc", name: "kumiko_orders_created_total", value: 1, labels: undefined },
    ]);
  });
});

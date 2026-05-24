import { describe, expect, it } from "bun:test";
import { type MetricEvent, RecordingMeter } from "../recording-meter";

function makeMeter() {
  const events: MetricEvent[] = [];
  const meter = new RecordingMeter((e) => events.push(e));
  return { meter, events };
}

describe("RecordingMeter", () => {
  it("counter.inc emits event with default value 1", () => {
    const { meter, events } = makeMeter();
    meter.registerMetric({ name: "kumiko_orders_created_total", type: "counter" });
    meter.counter("kumiko_orders_created_total").inc();
    expect(events).toEqual([
      { type: "counter.inc", name: "kumiko_orders_created_total", value: 1, labels: undefined },
    ]);
  });

  it("histogram.observe emits event with explicit value", () => {
    const { meter, events } = makeMeter();
    meter.registerMetric({
      name: "kumiko_http_request_duration_seconds",
      type: "histogram",
    });
    meter.histogram("kumiko_http_request_duration_seconds").observe(0.123);
    expect(events[0]).toMatchObject({ type: "histogram.observe", value: 0.123 });
  });

  it("gauge.set / inc / dec emit typed events", () => {
    const { meter, events } = makeMeter();
    meter.registerMetric({ name: "kumiko_sessions_active", type: "gauge" });
    const g = meter.gauge("kumiko_sessions_active");
    g.set(10);
    g.inc();
    g.dec(3);
    expect(events.map((e) => e.type)).toEqual(["gauge.set", "gauge.inc", "gauge.dec"]);
    expect(events.map((e) => e.value)).toEqual([10, 1, 3]);
  });

  it("label validation: unknown label throws", () => {
    const { meter } = makeMeter();
    meter.registerMetric({
      name: "kumiko_orders_created_total",
      type: "counter",
      labels: ["status"],
    });
    expect(() =>
      meter
        .counter("kumiko_orders_created_total")
        .inc(1, { unknown: "x" } as unknown as Record<string, string>),
    ).toThrow(/unknown label "unknown"/);
  });

  it("label validation: missing label throws", () => {
    const { meter } = makeMeter();
    meter.registerMetric({
      name: "kumiko_orders_created_total",
      type: "counter",
      labels: ["status"],
    });
    expect(() => meter.counter("kumiko_orders_created_total").inc()).toThrow(
      /expects labels status/,
    );
  });

  it("registerMetric validates label-key snake_case", () => {
    const { meter } = makeMeter();
    expect(() =>
      meter.registerMetric({
        name: "kumiko_x_total",
        type: "counter",
        labels: ["errorClass"],
      }),
    ).toThrow(/snake_case/);
  });

  it("tenantLabel adds tenant_id to declared labels", () => {
    const { meter } = makeMeter();
    meter.registerMetric({
      name: "kumiko_orders_created_total",
      type: "counter",
      labels: ["status"],
      tenantLabel: true,
    });
    expect(() => meter.counter("kumiko_orders_created_total").inc(1, { status: "new" })).toThrow(
      /missing label "tenant_id"/,
    );
    expect(() =>
      meter.counter("kumiko_orders_created_total").inc(1, { status: "new", tenant_id: 1 }),
    ).not.toThrow();
  });

  it("duplicate registration throws", () => {
    const { meter } = makeMeter();
    meter.registerMetric({ name: "kumiko_x_total", type: "counter" });
    expect(() => meter.registerMetric({ name: "kumiko_x_total", type: "counter" })).toThrow(
      /already registered/,
    );
  });
});

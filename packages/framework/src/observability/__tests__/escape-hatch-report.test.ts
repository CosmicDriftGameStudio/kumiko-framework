import { describe, expect, test } from "bun:test";
import type { EscapeHatchUseEvent } from "../../engine/types/index.js";
import type { Logger } from "../../logging/types.js";
import { testTenantId } from "../../stack/index.js";
import {
  createEscapeHatchProcessDedup,
  createEscapeHatchReporter,
  createEscapeHatchReportWindow,
  ESCAPE_HATCH_USED_SIGNAL,
  reportEscapeHatchUse,
} from "../escape-hatch-report.js";
import { type MetricEvent, RecordingMeter } from "../recording-meter.js";
import { registerStandardMetrics } from "../standard-metrics.js";

const tenantId = testTenantId(1);

function recordingLogger(): Logger & {
  readonly warnCalls: Array<{ msg: string; data?: Record<string, unknown> }>;
  readonly errorCalls: Array<{ msg: string; data?: Record<string, unknown> }>;
} {
  const warnCalls: Array<{ msg: string; data?: Record<string, unknown> }> = [];
  const errorCalls: Array<{ msg: string; data?: Record<string, unknown> }> = [];
  const logger: Logger & {
    warnCalls: typeof warnCalls;
    errorCalls: typeof errorCalls;
  } = {
    warnCalls,
    errorCalls,
    info() {},
    debug() {},
    warn(msg, data) {
      warnCalls.push({ msg, data });
    },
    error(msg, data) {
      errorCalls.push({ msg, data });
    },
    child() {
      return logger;
    },
  };
  return logger;
}

const baseEvent: EscapeHatchUseEvent = {
  handler: 'write "widgets:write:create"',
  kind: "unsafe-raw",
  reason: "legacy migration read",
  tenantId,
  actor: "user-1",
};

describe("createEscapeHatchReportWindow", () => {
  test("dedups an identical key within the window", () => {
    const window = createEscapeHatchReportWindow({ windowMs: 1000 });
    expect(window.shouldReport("k1", 0)).toBe(true);
    expect(window.shouldReport("k1", 500)).toBe(false);
    expect(window.shouldReport("k1", 999)).toBe(false);
  });

  test("reports again after the window expires", () => {
    const window = createEscapeHatchReportWindow({ windowMs: 1000 });
    expect(window.shouldReport("k1", 0)).toBe(true);
    expect(window.shouldReport("k1", 1000)).toBe(true);
  });

  test("evicts the oldest entry beyond maxEntries", () => {
    const window = createEscapeHatchReportWindow({ windowMs: 1000, maxEntries: 2 });
    expect(window.shouldReport("k1", 0)).toBe(true);
    expect(window.shouldReport("k2", 0)).toBe(true);
    // k3 pushes the cache past its cap — k1 (oldest) is evicted to make room.
    expect(window.shouldReport("k3", 0)).toBe(true);
    // k1 was evicted, so it is treated as new and reports again.
    expect(window.shouldReport("k1", 1)).toBe(true);
    // k3 is still within its window and was not evicted.
    expect(window.shouldReport("k3", 1)).toBe(false);
  });
});

describe("reportEscapeHatchUse", () => {
  test("sink present — calls the sink with the exact event and does not log.warn", () => {
    const calls: EscapeHatchUseEvent[] = [];
    const sink = async (event: EscapeHatchUseEvent) => {
      calls.push(event);
    };
    const log = recordingLogger();

    reportEscapeHatchUse(baseEvent, { sink, log });

    expect(calls).toEqual([baseEvent]);
    expect(log.warnCalls).toEqual([]);
  });

  test("no sink — log.warn called once with ESCAPE_HATCH_USED_SIGNAL and exact fields", () => {
    const log = recordingLogger();

    reportEscapeHatchUse(baseEvent, { log });

    expect(log.warnCalls.length).toBe(1);
    expect(log.warnCalls[0]?.msg).toBe(ESCAPE_HATCH_USED_SIGNAL);
    expect(log.warnCalls[0]?.data).toEqual({
      handler: baseEvent.handler,
      kind: baseEvent.kind,
      reason: baseEvent.reason,
      tenantId: baseEvent.tenantId,
      actor: baseEvent.actor,
    });
  });

  test("no sink, event has a target — target fields are included", () => {
    const log = recordingLogger();
    const eventWithTarget: EscapeHatchUseEvent = {
      ...baseEvent,
      kind: "identity-switch",
      target: { id: "user-2", tenantId },
    };

    reportEscapeHatchUse(eventWithTarget, { log });

    expect(log.warnCalls[0]?.data).toEqual({
      handler: eventWithTarget.handler,
      kind: eventWithTarget.kind,
      reason: eventWithTarget.reason,
      tenantId: eventWithTarget.tenantId,
      actor: eventWithTarget.actor,
      targetId: "user-2",
      targetTenantId: tenantId,
    });
  });

  test("sink rejection — logs via log.error", async () => {
    const log = recordingLogger();
    const sink = async () => {
      throw new Error("sink boom");
    };

    reportEscapeHatchUse(baseEvent, { sink, log });
    // The sink runs async — let its rejection settle before asserting.
    await Promise.resolve();
    await Promise.resolve();

    expect(log.errorCalls.length).toBe(1);
    expect(log.errorCalls[0]?.msg).toBe(`${ESCAPE_HATCH_USED_SIGNAL}: audit sink failed`);
    expect(log.errorCalls[0]?.data).toEqual({
      handler: baseEvent.handler,
      kind: baseEvent.kind,
      reason: baseEvent.reason,
      tenantId: baseEvent.tenantId,
      actor: baseEvent.actor,
      error: "sink boom",
    });
    expect(log.warnCalls).toEqual([]);
  });
});

describe("createEscapeHatchReporter with a process dedup (system cron hatches)", () => {
  const MINUTE_MS = 60_000;

  function setup(opts: { processDedup?: ReturnType<typeof createEscapeHatchProcessDedup> }) {
    const events: EscapeHatchUseEvent[] = [];
    const metricEvents: MetricEvent[] = [];
    const meter = new RecordingMeter((e) => metricEvents.push(e));
    registerStandardMetrics(meter);
    let nowMs = 0;
    const report = createEscapeHatchReporter({
      handler: "tenant-lifecycle:job:run-tenant-destruction",
      tenantId,
      actor: "system",
      sink: async (event) => {
        events.push(event);
      },
      window: createEscapeHatchReportWindow(),
      meter,
      now: () => nowMs,
      ...opts,
    });
    return {
      report,
      events,
      useMetrics: () =>
        metricEvents.filter((e) => e.name === "kumiko_escape_hatch_uses_total").length,
      advance: (ms: number) => {
        nowMs += ms;
      },
    };
  }

  test("audits a declared unsafe-raw once, however far apart the runs are, and counts every use", () => {
    const t = setup({
      processDedup: createEscapeHatchProcessDedup(["unsafe-raw", "global-write"]),
    });
    for (let run = 0; run < 3; run++) {
      t.report("unsafe-raw", "sweep");
      t.advance(2 * MINUTE_MS);
    }
    expect(t.events).toHaveLength(1);
    expect(t.useMetrics()).toBe(3);
  });

  test("dedups per (handler, kind): another kind is audited on its own", () => {
    const t = setup({
      processDedup: createEscapeHatchProcessDedup(["unsafe-raw", "global-write"]),
    });
    t.report("unsafe-raw", "sweep");
    t.report("global-write", "sweep");
    t.report("global-write", "sweep");
    expect(t.events.map((e) => e.kind)).toEqual(["unsafe-raw", "global-write"]);
  });

  test("kinds outside the process dedup stay on the 60 s window", () => {
    const t = setup({
      processDedup: createEscapeHatchProcessDedup(["unsafe-raw", "global-write"]),
    });
    t.report("identity-switch", "act as", { id: "u1", tenantId });
    t.report("identity-switch", "act as", { id: "u1", tenantId });
    expect(t.events).toHaveLength(1);
    t.advance(MINUTE_MS);
    t.report("identity-switch", "act as", { id: "u1", tenantId });
    expect(t.events).toHaveLength(2);
  });

  test("without a process dedup (user-triggered run) unsafe-raw is audited once per window", () => {
    const t = setup({});
    t.report("unsafe-raw", "manual");
    t.report("unsafe-raw", "manual");
    expect(t.events).toHaveLength(1);
    t.advance(MINUTE_MS);
    t.report("unsafe-raw", "manual");
    expect(t.events).toHaveLength(2);
    expect(t.useMetrics()).toBe(3);
  });

  test("each reporter set owns its own dedup state", () => {
    const first = setup({ processDedup: createEscapeHatchProcessDedup(["unsafe-raw"]) });
    const second = setup({ processDedup: createEscapeHatchProcessDedup(["unsafe-raw"]) });
    first.report("unsafe-raw", "sweep");
    second.report("unsafe-raw", "sweep");
    expect(first.events).toHaveLength(1);
    expect(second.events).toHaveLength(1);
  });
});

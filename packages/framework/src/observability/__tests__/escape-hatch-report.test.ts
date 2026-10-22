import { describe, expect, test } from "bun:test";
import type { EscapeHatchUseEvent } from "../../engine/types/index.ts";
import type { Logger } from "../../logging/types.ts";
import { testTenantId } from "../../seeding/seed-users.ts";
import {
  createEscapeHatchProcessDedup,
  createEscapeHatchReporter,
  createEscapeHatchReportWindow,
  ESCAPE_HATCH_USED_SIGNAL,
  flushEscapeHatchAudits,
  reportEscapeHatchUse,
  withEscapeHatchAuditScope,
  withEscapeHatchAuditScopeStream,
} from "../escape-hatch-report.ts";
import { type MetricEvent, RecordingMeter } from "../recording-meter.ts";
import { registerStandardMetrics } from "../standard-metrics.ts";

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

describe("escape-hatch audit durability", () => {
  function slowSink() {
    const persisted: EscapeHatchUseEvent[] = [];
    const sink = async (event: EscapeHatchUseEvent) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      persisted.push(event);
    };
    return { persisted, sink };
  }

  test("withEscapeHatchAuditScope resolves only after the sink write started inside it settled", async () => {
    const { persisted, sink } = slowSink();
    await withEscapeHatchAuditScope(async () => {
      reportEscapeHatchUse(baseEvent, { sink, log: recordingLogger() });
    });
    expect(persisted).toEqual([baseEvent]);
  });

  test("the stream scope reports audits from every pull and waits for them when the stream ends", async () => {
    const { persisted, sink } = slowSink();
    async function* handlerStream(): AsyncGenerator<number> {
      await Promise.resolve();
      reportEscapeHatchUse(baseEvent, { sink, log: recordingLogger() });
      yield 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      reportEscapeHatchUse(
        { ...baseEvent, reason: "second pull" },
        { sink, log: recordingLogger() },
      );
      yield 2;
    }

    const chunks: number[] = [];
    for await (const chunk of withEscapeHatchAuditScopeStream(handlerStream)) chunks.push(chunk);

    expect(chunks).toEqual([1, 2]);
    expect(persisted.map((event) => event.reason)).toEqual([baseEvent.reason, "second pull"]);
  });

  test("the stream scope waits for audits when the consumer closes the stream early", async () => {
    const { persisted, sink } = slowSink();
    async function* handlerStream(): AsyncGenerator<number> {
      reportEscapeHatchUse(baseEvent, { sink, log: recordingLogger() });
      yield 1;
      yield 2;
    }

    for await (const _chunk of withEscapeHatchAuditScopeStream(handlerStream)) break;

    expect(persisted).toEqual([baseEvent]);
  });

  test("a failing sink does not reject the scope and is logged", async () => {
    const log = recordingLogger();
    const sink = async () => {
      throw new Error("sink boom");
    };
    await withEscapeHatchAuditScope(async () => {
      reportEscapeHatchUse(baseEvent, { sink, log });
    });
    expect(log.errorCalls.length).toBe(1);
  });

  test("the scope still awaits the audit when the body throws, and rethrows the body's error", async () => {
    const { persisted, sink } = slowSink();
    const scope = withEscapeHatchAuditScope(async () => {
      reportEscapeHatchUse(baseEvent, { sink, log: recordingLogger() });
      throw new Error("handler failed");
    });
    await expect(scope).rejects.toThrow("handler failed");
    expect(persisted).toEqual([baseEvent]);
  });

  test("a nested scope leaves the wait to the outermost one", async () => {
    const { persisted, sink } = slowSink();
    let persistedWhenInnerReturned = -1;
    await withEscapeHatchAuditScope(async () => {
      await withEscapeHatchAuditScope(async () => {
        reportEscapeHatchUse(baseEvent, { sink, log: recordingLogger() });
      });
      persistedWhenInnerReturned = persisted.length;
    });
    expect(persistedWhenInnerReturned).toBe(0);
    expect(persisted.length).toBe(1);
  });

  test("flushEscapeHatchAudits awaits writes started outside any scope", async () => {
    const { persisted, sink } = slowSink();
    reportEscapeHatchUse(baseEvent, { sink, log: recordingLogger() });
    expect(persisted.length).toBe(0);
    await flushEscapeHatchAudits();
    expect(persisted).toEqual([baseEvent]);
  });

  test("the reporter puts the caller on the event and keeps callers apart in the dedup window", () => {
    const events: EscapeHatchUseEvent[] = [];
    const sink = async (event: EscapeHatchUseEvent) => {
      events.push(event);
    };
    const window = createEscapeHatchReportWindow();
    const reporterFor = (caller: string | undefined) =>
      createEscapeHatchReporter({
        handler: "job",
        tenantId,
        actor: "system",
        caller,
        sink,
        log: recordingLogger(),
        window,
      });
    reporterFor("user-1")("identity-switch", "reason");
    reporterFor("user-2")("identity-switch", "reason");
    expect(events.map((event) => event.caller)).toEqual(["user-1", "user-2"]);
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
      log: recordingLogger(),
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

  test("drops table-target entries older than the re-audit interval instead of keeping them forever", () => {
    const processDedup = createEscapeHatchProcessDedup(["global-write"]);
    const t = setup({ processDedup });
    for (let table = 0; table < 5; table++) {
      t.report("global-write", "sweep", { id: `table_${table}`, tenantId });
    }
    expect(processDedup.lastAuditedAt.size).toBe(5);

    t.advance(25 * 60 * MINUTE_MS);
    t.report("global-write", "sweep", { id: "table_fresh", tenantId });

    expect(processDedup.lastAuditedAt.size).toBe(1);
    expect(t.events).toHaveLength(6);
  });

  test("a cross-tenant-read cron audits once per day, not once per touched foreign row", () => {
    const processDedup = createEscapeHatchProcessDedup(["cross-tenant-read"]);
    const t = setup({ processDedup });
    for (let row = 0; row < 5; row++) {
      t.report("cross-tenant-read", "sweep", { id: `row-${row}`, tenantId });
    }
    expect(processDedup.lastAuditedAt.size).toBe(1);
    expect(t.events).toHaveLength(1);
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

  test("global-write to different target tables is audited per target", () => {
    const t = setup({ processDedup: createEscapeHatchProcessDedup(["global-write"]) });
    t.report("global-write", "sweep", { id: "table_a", tenantId });
    t.report("global-write", "sweep", { id: "table_b", tenantId });
    t.report("global-write", "sweep", { id: "table_a", tenantId });
    expect(t.events.map((e) => e.target?.id)).toEqual(["table_a", "table_b"]);
  });

  test("a long-lived process re-audits after 24 h so each retention window holds an event", () => {
    const t = setup({ processDedup: createEscapeHatchProcessDedup(["unsafe-raw"]) });
    t.report("unsafe-raw", "sweep");
    t.advance(24 * 60 * MINUTE_MS - 1);
    t.report("unsafe-raw", "sweep");
    expect(t.events).toHaveLength(1);
    t.advance(1);
    t.report("unsafe-raw", "sweep");
    expect(t.events).toHaveLength(2);
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

  test("a targetless cross-tenant read is audited once per hour, every other kind keeps the short window", () => {
    const t = setup({});
    t.report("acknowledge-cross-tenant", "read all");
    t.advance(59 * MINUTE_MS);
    t.report("acknowledge-cross-tenant", "read all");
    t.report("unsafe-raw", "manual");
    expect(t.events.map((e) => e.kind)).toEqual(["acknowledge-cross-tenant", "unsafe-raw"]);
    t.advance(MINUTE_MS);
    t.report("acknowledge-cross-tenant", "read all");
    t.report("unsafe-raw", "manual");
    expect(t.events.map((e) => e.kind)).toEqual([
      "acknowledge-cross-tenant",
      "unsafe-raw",
      "acknowledge-cross-tenant",
      "unsafe-raw",
    ]);
  });

  test("a cross-tenant read with a target is not stretched to the hour", () => {
    const t = setup({});
    t.report("cross-tenant-read", "read one", { id: "u1", tenantId });
    t.advance(MINUTE_MS);
    t.report("cross-tenant-read", "read one", { id: "u1", tenantId });
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

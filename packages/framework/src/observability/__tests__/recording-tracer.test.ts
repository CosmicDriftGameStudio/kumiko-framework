import { describe, expect, it } from "bun:test";
import { type RecordedSpan, RecordingTracer } from "../recording-tracer";
import { DEFAULT_SENSITIVE_CONFIG } from "../sensitive-filter";

function makeTracer() {
  const recorded: RecordedSpan[] = [];
  const tracer = new RecordingTracer({
    sensitiveConfig: DEFAULT_SENSITIVE_CONFIG,
    onSpanEnd: (s) => recorded.push(s),
  });
  return { tracer, recorded };
}

describe("RecordingTracer", () => {
  it("startSpan generates hex-encoded OTel-shaped IDs", () => {
    const { tracer } = makeTracer();
    const span = tracer.startSpan("test");
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
    span.end();
  });

  it("child span inherits traceId and references parent spanId", async () => {
    const { tracer, recorded } = makeTracer();
    await tracer.withSpan("root", async () => {
      await tracer.withSpan("child", async () => {});
    });
    const root = recorded.find((s) => s.name === "root")!;
    const child = recorded.find((s) => s.name === "child")!;
    expect(child.traceId).toBe(root.traceId);
    expect(child.parentSpanId).toBe(root.spanId);
    expect(root.parentSpanId).toBeUndefined();
  });

  it("sibling spans share traceId but have different spanIds", async () => {
    const { tracer, recorded } = makeTracer();
    await tracer.withSpan("root", async () => {
      await tracer.withSpan("a", async () => {});
      await tracer.withSpan("b", async () => {});
    });
    const a = recorded.find((s) => s.name === "a")!;
    const b = recorded.find((s) => s.name === "b")!;
    expect(a.traceId).toBe(b.traceId);
    expect(a.spanId).not.toBe(b.spanId);
  });

  it("withSpan ends span and records exception on throw", async () => {
    const { tracer, recorded } = makeTracer();
    await expect(
      tracer.withSpan("boom", async () => {
        throw new Error("kaboom");
      }),
    ).rejects.toThrow("kaboom");
    const span = recorded[0]!;
    expect(span.status).toBe("error");
    expect(span.exception?.message).toBe("kaboom");
    expect(span.endTime).toBeDefined();
  });

  it("getActiveSpan returns current span inside withSpan", async () => {
    const { tracer } = makeTracer();
    await tracer.withSpan("outer", async () => {
      expect(tracer.getActiveSpan()?.name).toBe("outer");
      await tracer.withSpan("inner", async () => {
        expect(tracer.getActiveSpan()?.name).toBe("inner");
      });
      expect(tracer.getActiveSpan()?.name).toBe("outer");
    });
    expect(tracer.getActiveSpan()).toBeUndefined();
  });

  it("setAttribute redacts sensitive keys", () => {
    const { tracer, recorded } = makeTracer();
    const span = tracer.startSpan("s");
    span.setAttribute("user.password", "hunter2");
    span.setAttribute("user.id", 42);
    span.end();
    expect(recorded[0]?.attributes["user.password"]).toBe("[REDACTED]");
    expect(recorded[0]?.attributes["user.id"]).toBe(42);
  });

  it("end is idempotent", () => {
    const { tracer, recorded } = makeTracer();
    const span = tracer.startSpan("s");
    span.end();
    span.end();
    expect(recorded).toHaveLength(1);
  });

  it("startSpan with parent context continues an upstream trace", () => {
    const { tracer, recorded } = makeTracer();
    const span = tracer.startSpan("child", {
      parent: {
        traceId: "aabbccddeeff00112233445566778899",
        spanId: "1122334455667788",
      },
    });
    span.end();
    expect(recorded[0]?.traceId).toBe("aabbccddeeff00112233445566778899");
    expect(recorded[0]?.parentSpanId).toBe("1122334455667788");
  });

  it("withSpan supports callback-only form", async () => {
    const { tracer, recorded } = makeTracer();
    const value = await tracer.withSpan("x", async (span) => {
      expect(span.name).toBe("x");
      return 123;
    });
    expect(value).toBe(123);
    expect(recorded).toHaveLength(1);
  });
});

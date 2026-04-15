import { describe, expect, it } from "vitest";
import { createConsoleProvider } from "../../observability";
import { mergeTraceFields } from "../pino-logger";

// The Pino trace-bridge hook is verified by directly exercising the helper
// that wrapPino uses. Going through pino's JSON output is flaky because
// pino buffers/async-writes; the helper is the actual contract, and the
// fact that wrapPino calls it on every log method is visible by inspection.

describe("mergeTraceFields", () => {
  it("adds traceId/spanId when an active span exists", async () => {
    const provider = createConsoleProvider({ writer: { log: () => {} } });
    let captured: Record<string, unknown> | undefined;
    await provider.tracer.withSpan("http.request", async () => {
      captured = mergeTraceFields({ user: "bob" });
    });
    expect(captured).toMatchObject({
      user: "bob",
      traceId: expect.stringMatching(/^[0-9a-f]{32}$/),
      spanId: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
  });

  it("returns data unchanged when no active span", () => {
    const result = mergeTraceFields({ foo: "bar" });
    expect(result).toEqual({ foo: "bar" });
  });

  it("returns undefined when neither span nor data", () => {
    expect(mergeTraceFields(undefined)).toBeUndefined();
  });

  it("caller data overrides trace fields when conflicting", async () => {
    const provider = createConsoleProvider({ writer: { log: () => {} } });
    let captured: Record<string, unknown> | undefined;
    await provider.tracer.withSpan("x", async () => {
      captured = mergeTraceFields({ traceId: "override" });
    });
    expect(captured?.["traceId"]).toBe("override");
  });

  it("returns just trace fields when data is undefined and span is active", async () => {
    const provider = createConsoleProvider({ writer: { log: () => {} } });
    let captured: Record<string, unknown> | undefined;
    await provider.tracer.withSpan("y", async () => {
      captured = mergeTraceFields(undefined);
    });
    expect(Object.keys(captured ?? {}).sort()).toEqual(["spanId", "traceId"]);
  });
});

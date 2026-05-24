import { describe, expect, it } from "bun:test";
import { createConsoleProvider } from "../console-provider";

function makeProvider() {
  const lines: string[] = [];
  const provider = createConsoleProvider({
    writer: { log: (l) => lines.push(l) },
  });
  return { provider, lines };
}

describe("ConsoleProvider", () => {
  it("prints the full span tree once root ends", async () => {
    const { provider, lines } = makeProvider();
    await provider.tracer.withSpan("http.request", async () => {
      await provider.tracer.withSpan("db.query", async (span) => {
        span.setAttribute("db.table", "orders");
      });
      await provider.tracer.withSpan("redis.cmd", async () => {});
    });
    expect(lines).toHaveLength(1);
    const output = lines[0]!;
    expect(output).toContain("http.request");
    expect(output).toContain("db.query");
    expect(output).toContain("redis.cmd");
    expect(output).toContain("db.table=orders");
  });

  it("marks errored spans with [ERR]", async () => {
    const { provider, lines } = makeProvider();
    await expect(
      provider.tracer.withSpan("http.request", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(lines[0]).toContain("[ERR]");
    expect(lines[0]).toContain("!exception=Error: boom");
  });

  it("emits metric events as log lines", () => {
    const { provider, lines } = makeProvider();
    provider.meter.registerMetric({
      name: "kumiko_orders_created_total",
      type: "counter",
    });
    provider.meter.counter("kumiko_orders_created_total").inc();
    expect(lines[0]).toContain("counter.inc");
    expect(lines[0]).toContain("kumiko_orders_created_total");
    expect(lines[0]).toContain("value=1");
  });

  it("renders nested tree with correct hierarchy", async () => {
    const { provider, lines } = makeProvider();
    await provider.tracer.withSpan("http.request", async () => {
      await provider.tracer.withSpan("kumiko.dispatcher.handler", async () => {
        await provider.tracer.withSpan("db.query", async () => {});
      });
    });
    const out = lines[0]!;
    const httpIdx = out.indexOf("http.request");
    const dispatcherIdx = out.indexOf("kumiko.dispatcher.handler");
    const dbIdx = out.indexOf("db.query");
    expect(httpIdx).toBeGreaterThanOrEqual(0);
    expect(dispatcherIdx).toBeGreaterThan(httpIdx);
    expect(dbIdx).toBeGreaterThan(dispatcherIdx);
  });
});

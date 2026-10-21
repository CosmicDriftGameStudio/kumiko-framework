import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { type MetricEvent, RecordingMeter } from "../../observability/recording-meter.ts";
import { STANDARD_METRIC_DEFS } from "../../observability/standard-metrics.ts";
import { authEndpointRateLimit, createFailOpenReporter, globalIpRateLimit } from "../middleware.ts";
import type { RateLimitResolver } from "../resolver.ts";

const CLIENT_IP = "203.0.113.9";

function failingResolver(error: Error): RateLimitResolver {
  const failingCall = async (): Promise<never> => {
    throw error;
  };
  return { check: failingCall, enforce: failingCall, enforceAll: failingCall, peek: failingCall };
}

function redisErrorCarryingIp(): Error {
  return Object.assign(new Error("connection refused"), {
    command: { name: "evalsha", args: [`l1:${CLIENT_IP}`] },
  });
}

describe("default rate-limit failure logging", () => {
  let errorSpy: ReturnType<typeof spyOn<Console, "error">>;
  let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;

  beforeEach(() => {
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test("L2 fail-closed logs only the error message, never the ioredis command args carrying the client IP", async () => {
    const app = new Hono();
    app.use(
      "*",
      authEndpointRateLimit({
        resolver: failingResolver(redisErrorCarryingIp()),
        extractIp: () => CLIENT_IP,
      }),
    );
    app.post("/", (c) => c.text("ok"));

    const res = await app.request("/", { method: "POST" });

    expect(res.status).toBe(503);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = errorSpy.mock.calls[0] ?? [];
    expect(logged.some((arg) => JSON.stringify(arg)?.includes(CLIENT_IP))).toBe(false);
    expect(logged).toContainEqual({ error: "connection refused" });
  });

  test("L1 fails open and its warn carries only the error message", async () => {
    const app = new Hono();
    app.use(
      "*",
      globalIpRateLimit({
        resolver: failingResolver(redisErrorCarryingIp()),
        extractIp: () => CLIENT_IP,
      }),
    );
    app.get("/", (c) => c.text("ok"));

    const res = await app.request("/");

    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warnSpy.mock.calls[0])).not.toContain(CLIENT_IP);
    expect(JSON.stringify(warnSpy.mock.calls[0])).toContain("connection refused");
  });

  test("the fail-open warn is throttled to once per 30 s per reporter while every failure counts", () => {
    let nowMs = 1_000_000;
    const events: MetricEvent[] = [];
    const meter = new RecordingMeter((event) => events.push(event));
    for (const def of STANDARD_METRIC_DEFS) meter.registerMetric(def);
    const report = createFailOpenReporter("l1-global-ip", meter, () => nowMs);

    report(new Error("down"));
    nowMs += 10_000;
    report(new Error("down"));
    expect(warnSpy).toHaveBeenCalledTimes(1);
    nowMs += 20_000;
    report(new Error("down"));
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(events.map((e) => [e.name, e.labels])).toEqual(
      Array(3).fill(["kumiko_rate_limit_fail_open_total", { label: "l1-global-ip" }]),
    );
  });
});

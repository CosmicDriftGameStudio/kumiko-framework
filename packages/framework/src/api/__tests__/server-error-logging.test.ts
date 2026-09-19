import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { z } from "zod";
import { createRegistry, defineFeature } from "../../engine";
import { RateLimitError, UnprocessableError } from "../../errors";
import { TestUsers } from "../../stack";
import { ensureTemporalPolyfill } from "../../time";
import { buildServer } from "../server";

// Self-ensure Temporal rather than rely on the suite-level preload: the check
// runs `bun test` from packages/framework where the root preload path doesn't
// resolve, so buildHandlerContext would otherwise throw before our handler runs
// and the logged cause would be the polyfill error, not the thrown one.
await ensureTemporalPolyfill();

const JWT_SECRET = "test-secret-at-least-32-chars-long!!";

const openToAll = {
  access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
} as const;

const boomFeature = defineFeature("boom", (r) => {
  r.queryHandler(
    "explode",
    z.object({}),
    async () => {
      throw new Error("disk on fire");
    },
    openToAll,
  );
  r.queryHandler(
    "decode",
    z.object({}),
    async () => {
      throw new UnprocessableError("vin_not_decodable", {
        details: { vin: "WDB0000000SECRET" },
      });
    },
    openToAll,
  );
  r.queryHandler(
    "throttled",
    z.object({}),
    async () => {
      throw new RateLimitError({
        bucket: "ip:203.0.113.7",
        limit: 1,
        windowSeconds: 60,
        remaining: 0,
        retryAfterSeconds: 60,
        resetAt: "2026-01-01T00:00:00.000Z",
      });
    },
    openToAll,
  );
  r.queryHandler(
    "login",
    z.object({ email: z.email(), password: z.string().min(8) }),
    async () => ({ ok: true }),
    openToAll,
  );
});

const { app, jwt } = buildServer({
  registry: createRegistry([boomFeature]),
  context: {},
  jwtSecret: JWT_SECRET,
});

async function auth(): Promise<Record<string, string>> {
  const token = await jwt.sign(TestUsers.admin);
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// Find the `[api] handler failed` line our logServerFault emits (createFallback
// Logger console-falls-back to `console.error("[api] handler failed", data)`).
// Match on the namespaced message so unrelated console noise can't false-fire.
function apiFaultLog(calls: unknown[][]): string | undefined {
  const hit = calls.find(
    (args) => typeof args[0] === "string" && args[0].includes("[api] handler failed"),
  );
  return hit ? JSON.stringify(hit) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// The `[api] handler rejected` warn line logServerFault emits for 4xx.
function apiRejectionLog(calls: unknown[][]): Record<string, unknown> | undefined {
  const hit = calls.find(
    (args) => typeof args[0] === "string" && args[0].includes("[api] handler rejected"),
  );
  return isRecord(hit?.[1]) ? hit[1] : undefined;
}

async function queryWithCapturedWarnings(
  type: string,
  payload: unknown,
): Promise<{ status: number; warnings: unknown[][]; errors: unknown[][] }> {
  const warnings: unknown[][] = [];
  const errors: unknown[][] = [];
  const warnSpy = spyOn(console, "warn").mockImplementation((...args) => {
    warnings.push(args);
  });
  const errorSpy = spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args);
  });
  try {
    const res = await app.request("/api/query", {
      method: "POST",
      headers: await auth(),
      body: JSON.stringify({ type, payload }),
    });
    return { status: res.status, warnings, errors };
  } finally {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  }
}

describe("HTTP layer logs unexpected 5xx faults", () => {
  test("a throwing query 500s AND the cause stack reaches the log", async () => {
    const calls: unknown[][] = [];
    const spy = spyOn(console, "error").mockImplementation((...args) => {
      calls.push(args);
    });
    try {
      const res = await app.request("/api/query", {
        method: "POST",
        headers: await auth(),
        body: JSON.stringify({ type: "boom:query:explode", payload: {} }),
      });
      expect(res.status).toBe(500);
      const logged = apiFaultLog(calls);
      expect(logged).toBeDefined();
      expect(logged).toContain("boom:query:explode"); // which handler 500'd
      expect(logged).toContain("disk on fire"); // the cause — the line that was missing in prod
    } finally {
      spy.mockRestore();
    }
  });

  test("a 404 stays off the error level (it is a client outcome, not a server fault)", async () => {
    const { status, errors } = await queryWithCapturedWarnings("nope:query:nothing", {});
    expect(status).toBe(404);
    expect(apiFaultLog(errors)).toBeUndefined();
  });
});

describe("HTTP layer logs 4xx client faults on warn (#3077)", () => {
  let previousLogLevel: string | undefined;

  beforeEach(() => {
    previousLogLevel = process.env["LOG_LEVEL"];
    process.env["LOG_LEVEL"] = "info";
  });

  afterEach(() => {
    if (previousLogLevel === undefined) delete process.env["LOG_LEVEL"];
    else process.env["LOG_LEVEL"] = previousLogLevel;
  });

  test("a 422 leaves a log line with status, code and duration", async () => {
    const { status, warnings } = await queryWithCapturedWarnings("boom:query:decode", {});
    expect(status).toBe(422);
    const logged = apiRejectionLog(warnings);
    expect(logged).toBeDefined();
    expect(logged?.["status"]).toBe(422);
    expect(logged?.["code"]).toBe("unprocessable");
    expect(logged?.["type"]).toBe("boom:query:decode");
    expect(typeof logged?.["durationMs"]).toBe("number");
    expect(logged?.["durationMs"]).toBeGreaterThanOrEqual(0);
  });

  test("a 429 leaves a log line", async () => {
    const { status, warnings } = await queryWithCapturedWarnings("boom:query:throttled", {});
    expect(status).toBe(429);
    expect(apiRejectionLog(warnings)?.["status"]).toBe(429);
    expect(apiRejectionLog(warnings)?.["code"]).toBe("rate_limited");
  });

  test("a 400 validation failure leaves a log line", async () => {
    const { status, warnings } = await queryWithCapturedWarnings("boom:query:login", {
      email: "nope",
      password: "short",
    });
    expect(status).toBe(400);
    expect(apiRejectionLog(warnings)?.["status"]).toBe(400);
    expect(apiRejectionLog(warnings)?.["code"]).toBe("validation_error");
  });

  test("a 404 leaves a log line and truncates the client-supplied type", async () => {
    const longType = `ghost:query:${"x".repeat(500)}`;
    const { status, warnings } = await queryWithCapturedWarnings(longType, {});
    expect(status).toBe(404);
    const loggedType = apiRejectionLog(warnings)?.["type"];
    expect(typeof loggedType).toBe("string");
    expect(String(loggedType).length).toBeLessThanOrEqual(120);
  });

  test("the 4xx line carries no submitted values, no message, no details, no stack", async () => {
    const { warnings } = await queryWithCapturedWarnings("boom:query:login", {
      email: "victim-at-example.com",
      password: "hunter2-super-secret",
      apiKey: "sk-live-0000000000",
    });
    const logged = apiRejectionLog(warnings);
    expect(logged).toBeDefined();
    expect(Object.keys(logged ?? {}).sort()).toEqual([
      "code",
      "durationMs",
      "requestId",
      "status",
      "type",
    ]);
    const serialized = JSON.stringify(logged);
    expect(serialized).not.toContain("victim-at-example.com");
    expect(serialized).not.toContain("hunter2-super-secret");
    expect(serialized).not.toContain("sk-live-0000000000");
  });

  test("a 422 does NOT reach the error level (5xx contract unchanged)", async () => {
    const { errors } = await queryWithCapturedWarnings("boom:query:decode", {});
    expect(apiFaultLog(errors)).toBeUndefined();
  });

  test("LOG_LEVEL=error silences the 4xx lines but keeps 5xx", async () => {
    process.env["LOG_LEVEL"] = "error";

    const rejected = await queryWithCapturedWarnings("boom:query:decode", {});
    expect(rejected.status).toBe(422);
    expect(apiRejectionLog(rejected.warnings)).toBeUndefined();

    const exploded = await queryWithCapturedWarnings("boom:query:explode", {});
    expect(exploded.status).toBe(500);
    expect(apiFaultLog(exploded.errors)).toBeDefined();
  });
});

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createRegistry } from "../../engine/index.js";
import { TestUsers } from "../../stack/index.js";
import { ensureTemporalPolyfill } from "../../time/index.js";
import { handleUncaughtRouteError } from "../routes.js";
import { buildServer } from "../server.js";

await ensureTemporalPolyfill();

const JWT_SECRET = "test-secret-at-least-32-chars-long!!";

const { app, jwt } = buildServer({
  registry: createRegistry([]),
  context: {},
  jwtSecret: JWT_SECRET,
});

// Registered on the root app after buildServer: they sit behind the same /api/*
// middleware as real routes and throw instead of shaping a response.
app.get("/api/test-rethrow-abort", async (c) => {
  abortMidRequest?.();
  c.req.raw.signal.throwIfAborted();
  return c.json({ ok: true });
});
app.get("/api/test-generic-throw", () => {
  throw new Error("disk on fire");
});
app.get("/api/test-http-exception", () => {
  throw new HTTPException(418, { message: "short and stout" });
});

let abortMidRequest: (() => void) | undefined;
let warnings: unknown[][];
let errors: unknown[][];
let warnSpy: ReturnType<typeof spyOn<typeof console, "warn">>;
let errorSpy: ReturnType<typeof spyOn<typeof console, "error">>;

beforeEach(() => {
  warnings = [];
  errors = [];
  warnSpy = spyOn(console, "warn").mockImplementation((...args) => {
    warnings.push(args);
  });
  errorSpy = spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args);
  });
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  abortMidRequest = undefined;
});

async function authHeaders(): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await jwt.sign(TestUsers.admin)}` };
}

function logged(calls: unknown[][], text: string): boolean {
  return calls.some((args) => typeof args[0] === "string" && args[0].includes(text));
}

describe("root app.onError", () => {
  test("a rethrown client abort answers 499 with no body, warns, and never hits console.error", async () => {
    const controller = new AbortController();
    abortMidRequest = () => controller.abort();
    const res = await app.request(
      new Request("http://test.local/api/test-rethrow-abort", {
        headers: await authHeaders(),
        signal: controller.signal,
      }),
    );
    expect(res.status).toBe(499);
    expect(await res.text()).toBe("");
    expect(logged(warnings, "[api] request aborted by client")).toBe(true);
    expect(errors).toEqual([]);
  });

  test("an uncaught generic throw is a 500 JSON envelope plus the '[api] handler failed' line", async () => {
    const res = await app.request("/api/test-generic-throw", { headers: await authHeaders() });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: { code?: string; message?: string } }; // @cast-boundary test-seam — response body
    expect(body.error?.code).toBe("internal_error");
    expect(body.error?.message).toBe("internal error");
    expect(logged(errors, "[api] handler failed")).toBe(true);
    expect(JSON.stringify(errors)).toContain("disk on fire");
  });

  test("an abort that did not come from this request's signal stays a 500", async () => {
    const res = await app.request("/api/test-generic-throw", {
      headers: await authHeaders(),
      signal: AbortSignal.abort(),
    });
    expect(res.status).toBe(500);
    expect(logged(errors, "[api] handler failed")).toBe(true);
  });

  test("an HTTPException passes through with its own response", async () => {
    const res = await app.request("/api/test-http-exception", { headers: await authHeaders() });
    expect(res.status).toBe(418);
    expect(await res.text()).toBe("short and stout");
    expect(errors).toEqual([]);
  });

  test("a sub-app mounted with route() and no handler of its own inherits it", async () => {
    const parent = new Hono();
    parent.onError(handleUncaughtRouteError);
    const sub = new Hono();
    sub.get("/rethrow", (c) => {
      c.req.raw.signal.throwIfAborted();
      return c.json({ ok: true });
    });
    parent.route("/api", sub);
    const res = await parent.request(
      new Request("http://test.local/api/rethrow", { signal: AbortSignal.abort() }),
    );
    expect(res.status).toBe(499);
    expect(errors).toEqual([]);
  });
});

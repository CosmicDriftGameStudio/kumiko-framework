import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { requestContext } from "../request-context";
import { requestIdMiddleware } from "../request-id-middleware";

describe("requestIdMiddleware — signal propagation", () => {
  test("AbortSignal from c.req.raw lands in requestContext.signal", async () => {
    let captured: { signal: AbortSignal | undefined; requestId: string | undefined } = {
      signal: undefined,
      requestId: undefined,
    };

    const app = new Hono();
    app.use("/probe", requestIdMiddleware());
    app.get("/probe", (c) => {
      const ctx = requestContext.get();
      captured = { signal: ctx?.signal, requestId: ctx?.requestId };
      return c.text("ok");
    });

    const controller = new AbortController();
    // Hono's app.request takes a Request OR a string + RequestInit. Pass
    // a real Request so AbortSignal flows the way it does in production.
    const res = await app.request(
      new Request("http://test.local/probe", {
        method: "GET",
        signal: controller.signal,
      }),
    );

    expect(res.status).toBe(200);
    expect(captured.requestId).toBeDefined();
    expect(captured.signal).toBeInstanceOf(AbortSignal);
    expect(captured.signal?.aborted).toBe(false);
  });

  test("abort during handler execution flips ctx.signal.aborted to true", async () => {
    // Handler holds the request open via a small delay. We fire abort()
    // in the middle of that delay so the handler is guaranteed to be
    // running when the signal flips — proves real propagation, not just
    // "the field exists".
    let captured: AbortSignal | undefined;

    const app = new Hono();
    app.use("/probe", requestIdMiddleware());
    app.get("/probe", async (c) => {
      captured = requestContext.get()?.signal;
      await new Promise((resolve) => setTimeout(resolve, 60));
      return c.text("ok");
    });

    const controller = new AbortController();
    const fetchPromise = app.request(
      new Request("http://test.local/probe", {
        method: "GET",
        signal: controller.signal,
      }),
    );
    // Fire abort while the handler is awaiting the timeout.
    setTimeout(() => controller.abort(), 20);

    try {
      await fetchPromise;
    } catch {
      // node may surface the abort as a thrown AbortError on the outer
      // promise; we only care about the handler's view via captured.
    }

    expect(captured).toBeDefined();
    expect(captured?.aborted).toBe(true);
  });
});
describe("requestIdMiddleware — ip + userAgent capture (603/2)", () => {
  test("populates ip from x-forwarded-for and userAgent from the User-Agent header", async () => {
    let captured: { ip: string | undefined; userAgent: string | undefined } = {
      ip: undefined,
      userAgent: undefined,
    };

    const app = new Hono();
    app.use("/probe", requestIdMiddleware());
    app.get("/probe", (c) => {
      const ctx = requestContext.get();
      captured = { ip: ctx?.ip, userAgent: ctx?.userAgent };
      return c.text("ok");
    });

    const res = await app.request(
      new Request("http://test.local/probe", {
        method: "GET",
        headers: {
          "x-forwarded-for": "203.0.113.7, 10.0.0.1",
          "user-agent": "Mozilla/5.0 (probe-test)",
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(captured.ip).toBe("203.0.113.7");
    expect(captured.userAgent).toBe("Mozilla/5.0 (probe-test)");
  });

  test("no User-Agent header → userAgent stays undefined, not an empty string", async () => {
    let captured: string | undefined = "unset";

    const app = new Hono();
    app.use("/probe", requestIdMiddleware());
    app.get("/probe", (c) => {
      captured = requestContext.get()?.userAgent;
      return c.text("ok");
    });

    // fetch/undici always add a default User-Agent unless explicitly cleared —
    // Hono's app.request accepts a raw Request, so an empty-but-present header
    // simulates a client that sends the header with no value.
    const res = await app.request(
      new Request("http://test.local/probe", { method: "GET", headers: {} }),
    );

    expect(res.status).toBe(200);
    expect(captured).toBeUndefined();
  });
});

describe("requestIdMiddleware — client-supplied id sanitization (input-validation)", () => {
  test("oversized X-Request-ID is rejected, a fresh id is generated instead", async () => {
    let captured: string | undefined;

    const app = new Hono();
    app.use("/probe", requestIdMiddleware());
    app.get("/probe", (c) => {
      captured = requestContext.get()?.requestId;
      return c.text("ok");
    });

    const junk = "x".repeat(5000);
    const res = await app.request(
      new Request("http://test.local/probe", {
        method: "GET",
        headers: { "X-Request-ID": junk },
      }),
    );

    expect(res.status).toBe(200);
    expect(captured).toBeDefined();
    expect(captured).not.toBe(junk);
    expect(captured?.length).toBeLessThan(128);
  });

  test("disallowed-character X-Correlation-ID falls back to the (sanitized) requestId", async () => {
    let captured: { requestId: string | undefined; correlationId: string | undefined } = {
      requestId: undefined,
      correlationId: undefined,
    };

    const app = new Hono();
    app.use("/probe", requestIdMiddleware());
    app.get("/probe", (c) => {
      const ctx = requestContext.get();
      captured = { requestId: ctx?.requestId, correlationId: ctx?.correlationId };
      return c.text("ok");
    });

    const res = await app.request(
      new Request("http://test.local/probe", {
        method: "GET",
        headers: { "X-Request-ID": "req-1", "X-Correlation-ID": "corr injected; drop table" },
      }),
    );

    expect(res.status).toBe(200);
    expect(captured.requestId).toBe("req-1");
    expect(captured.correlationId).toBe("req-1");
  });

  test("a well-formed client id is preserved", async () => {
    let captured: string | undefined;

    const app = new Hono();
    app.use("/probe", requestIdMiddleware());
    app.get("/probe", (c) => {
      captured = requestContext.get()?.requestId;
      return c.text("ok");
    });

    const res = await app.request(
      new Request("http://test.local/probe", {
        method: "GET",
        headers: { "X-Request-ID": "trace-abc123.def" },
      }),
    );

    expect(res.status).toBe(200);
    expect(captured).toBe("trace-abc123.def");
  });
});

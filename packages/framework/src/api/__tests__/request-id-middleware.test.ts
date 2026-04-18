import { Hono } from "hono";
import { describe, expect, test } from "vitest";
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

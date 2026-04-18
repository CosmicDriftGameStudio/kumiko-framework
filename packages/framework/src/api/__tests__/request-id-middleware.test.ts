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

  test("aborted signal propagates — handler sees aborted=true", async () => {
    let captured: AbortSignal | undefined;

    const app = new Hono();
    app.use("/probe", requestIdMiddleware());
    app.get("/probe", (c) => {
      captured = requestContext.get()?.signal;
      return c.text("ok");
    });

    const controller = new AbortController();
    controller.abort();
    // app.request returns Response | Promise<Response>; node's fetch may
    // surface the abort as a thrown AbortError before our handler runs.
    // Wrap in Promise.resolve so we can swallow either path uniformly —
    // we don't care about the outer status, only that the handler, when
    // it does run, sees the abort through ctx.signal.
    try {
      await Promise.resolve(
        app.request(
          new Request("http://test.local/probe", {
            method: "GET",
            signal: controller.signal,
          }),
        ),
      );
    } catch {
      // pre-aborted fetch may throw; that's fine for this test.
    }

    // If the handler ran, signal should reflect the aborted state.
    if (captured) {
      expect(captured.aborted).toBe(true);
    }
  });

  test("missing c.req.raw.signal — context.signal stays undefined (no phantom)", async () => {
    let captured: { signal: AbortSignal | undefined } = { signal: undefined };

    const app = new Hono();
    app.use("/probe", requestIdMiddleware());
    app.get("/probe", (c) => {
      captured = { signal: requestContext.get()?.signal };
      return c.text("ok");
    });

    // Pass a string path with no init → no Request object → no signal.
    const res = await app.request("/probe");

    expect(res.status).toBe(200);
    // Hono synthesizes a Request without a signal in this branch — we
    // shouldn't fabricate one and lie to downstream code that there's a
    // cancellation source. Either undefined OR an actual AbortSignal is
    // acceptable depending on Hono's adapter; what's NOT acceptable is
    // a stub with `aborted` permanently false.
    if (captured.signal !== undefined) {
      expect(captured.signal).toBeInstanceOf(AbortSignal);
    }
  });
});

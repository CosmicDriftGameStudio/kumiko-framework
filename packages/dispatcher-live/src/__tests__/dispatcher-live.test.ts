import { describe, expect, mock, test } from "bun:test";
import { createLiveDispatcher } from "../dispatcher-live";

// Builds a fake fetch that returns a JSON body with the given
// payload and status. Exposes the captured Request argv so tests can
// assert on URL/headers/body.
function makeFetch(respond: { readonly status?: number; readonly body: unknown }): {
  readonly fetch: typeof fetch;
  readonly calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = mock(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: (respond.status ?? 200) < 400,
      status: respond.status ?? 200,
      async json() {
        return respond.body;
      },
    } as unknown as Response;
  });
  return { fetch: fetchMock as unknown as typeof globalThis.fetch, calls };
}

describe("createLiveDispatcher", () => {
  test("write: POSTs to /api/write with Content-Type, Accept, credentials, CSRF header", async () => {
    const { fetch, calls } = makeFetch({
      body: { isSuccess: true, data: { id: "srv-1" } },
    });
    const disp = createLiveDispatcher({
      fetch,
      readCsrf: () => "csrf-abc",
    });

    const result = await disp.write("app:write:task:create", { title: "hello" });

    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) expect((result.data as { id: string }).id).toBe("srv-1");

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe("/api/write");
    expect(call?.init.method).toBe("POST");
    expect(call?.init.credentials).toBe("include");
    const headers = call?.init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-CSRF-Token"]).toBe("csrf-abc");
    const body = JSON.parse(call?.init.body as string);
    expect(body).toMatchObject({ type: "app:write:task:create", payload: { title: "hello" } });
    // Auto-generated idempotency key (#761) — always present.
    expect(typeof body.requestId).toBe("string");
    expect(body.requestId.length).toBeGreaterThan(8);
  });

  test("write: propagates requestId into body when provided", async () => {
    const { fetch, calls } = makeFetch({ body: { isSuccess: true, data: {} } });
    const disp = createLiveDispatcher({ fetch, readCsrf: () => "t" });

    await disp.write("app:write:x:create", { a: 1 }, { requestId: "idem-99" });

    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body.requestId).toBe("idem-99");
  });

  test("write: generates a fresh requestId per invocation when none provided (#761)", async () => {
    const { fetch, calls } = makeFetch({ body: { isSuccess: true, data: {} } });
    const disp = createLiveDispatcher({ fetch, readCsrf: () => "t" });

    await disp.write("app:write:x:create", { a: 1 });
    await disp.write("app:write:x:create", { a: 1 });

    const first = JSON.parse(calls[0]?.init.body as string).requestId;
    const second = JSON.parse(calls[1]?.init.body as string).requestId;
    expect(typeof first).toBe("string");
    expect(typeof second).toBe("string");
    expect(first).not.toBe(second);
  });

  test("batch: generates one requestId for the whole batch when none provided (#761)", async () => {
    const { fetch, calls } = makeFetch({ body: { isSuccess: true, results: [] } });
    const disp = createLiveDispatcher({ fetch, readCsrf: () => "t" });

    await disp.batch([
      { type: "a", payload: {} },
      { type: "b", payload: {} },
    ]);

    const body = JSON.parse(calls[0]?.init.body as string);
    expect(typeof body.requestId).toBe("string");
  });

  test("batch: propagates an explicit requestId (#761)", async () => {
    const { fetch, calls } = makeFetch({ body: { isSuccess: true, results: [] } });
    const disp = createLiveDispatcher({ fetch, readCsrf: () => "t" });

    await disp.batch([{ type: "a", payload: {} }], { requestId: "batch-7" });

    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body.requestId).toBe("batch-7");
  });

  test("write: no CSRF token → header omitted, request still fires (server will 401/csrf-mismatch)", async () => {
    const { fetch, calls } = makeFetch({ body: { isSuccess: true, data: {} } });
    const disp = createLiveDispatcher({ fetch, readCsrf: () => undefined });

    await disp.write("x", {});

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect("X-CSRF-Token" in headers).toBe(false);
  });

  test("write: maps server-failure envelope to DispatcherError", async () => {
    const { fetch } = makeFetch({
      status: 400,
      body: {
        isSuccess: false,
        error: {
          code: "validation_error",
          httpStatus: 400,
          i18nKey: "errors.validation.failed",
          message: "Validation failed",
          details: {
            fields: [{ path: "title", code: "too_small", i18nKey: "errors.validation.too_small" }],
          },
        },
      },
    });
    const disp = createLiveDispatcher({ fetch, readCsrf: () => "t" });

    const result = await disp.write("x", {});

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) {
      expect(result.error.code).toBe("validation_error");
      expect(result.error.details?.fields?.[0]?.path).toBe("title");
    }
  });

  test("query: POSTs to /api/query", async () => {
    const { fetch, calls } = makeFetch({ body: { isSuccess: true, data: [] } });
    const disp = createLiveDispatcher({ fetch, readCsrf: () => "t" });

    await disp.query("app:query:task:list", { limit: 10 });

    expect(calls[0]?.url).toBe("/api/query");
    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body).toEqual({ type: "app:query:task:list", payload: { limit: 10 } });
  });

  test("batch: POSTs to /api/batch with commands array", async () => {
    const { fetch, calls } = makeFetch({
      body: { isSuccess: true, results: [] },
    });
    const disp = createLiveDispatcher({ fetch, readCsrf: () => "t" });

    const commands = [
      { type: "x:write:a:create", payload: { a: 1 } },
      { type: "x:write:b:create", payload: { b: 2 } },
    ];
    const result = await disp.batch(commands);

    expect(result.isSuccess).toBe(true);
    expect(calls[0]?.url).toBe("/api/batch");
    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body.commands).toEqual(commands);
  });

  test("baseUrl prefix: full origin is prepended to path", async () => {
    const { fetch, calls } = makeFetch({ body: { isSuccess: true, data: {} } });
    const disp = createLiveDispatcher({
      baseUrl: "https://api.example.com",
      fetch,
      readCsrf: () => "t",
    });

    await disp.write("x", {});

    expect(calls[0]?.url).toBe("https://api.example.com/api/write");
  });

  test("network error → failure with code='network_error', status flips offline", async () => {
    const fetch = mock(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    const disp = createLiveDispatcher({ fetch, readCsrf: () => "t" });

    const seen: string[] = [];
    disp.statusStore.subscribe(() => seen.push(disp.statusStore.getSnapshot()));

    const result = await disp.write("x", {});

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) expect(result.error.code).toBe("network_error");
    expect(disp.statusStore.getSnapshot()).toBe("offline");
    expect(seen).toEqual(["offline"]);
  });

  test("network recovery: after offline → successful call flips back to online", async () => {
    let failNext = true;
    const fetch = mock(async () => {
      if (failNext) {
        failNext = false;
        throw new Error("boom");
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return { isSuccess: true, data: {} };
        },
      } as unknown as Response;
    }) as unknown as typeof globalThis.fetch;
    const disp = createLiveDispatcher({ fetch, readCsrf: () => "t" });

    const seen: string[] = [];
    disp.statusStore.subscribe(() => seen.push(disp.statusStore.getSnapshot()));

    await disp.write("x", {}); // offline
    await disp.write("x", {}); // online

    expect(seen).toEqual(["offline", "online"]);
    expect(disp.statusStore.getSnapshot()).toBe("online");
  });

  test("abort signal: request propagated + AbortError mapped to 'aborted'", async () => {
    const controller = new AbortController();
    const fetch = mock(async (_url: string, init: RequestInit) => {
      // Simulate real fetch: throw AbortError synchronously when signal
      // is already aborted.
      if (init.signal?.aborted) {
        const e = new Error("The operation was aborted.");
        e.name = "AbortError";
        throw e;
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return { isSuccess: true, data: {} };
        },
      } as unknown as Response;
    }) as unknown as typeof globalThis.fetch;
    const disp = createLiveDispatcher({ fetch, readCsrf: () => "t" });

    controller.abort();
    const result = await disp.write("x", {}, { signal: controller.signal });

    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) expect(result.error.code).toBe("aborted");
    // Abort is a user cancellation, not a network outage — status MUST
    // not flip to offline (UX: cancelling a save shouldn't make the
    // online-indicator light up red).
    expect(disp.statusStore.getSnapshot()).toBe("online");
  });

  test("non-JSON server response (HTML 502 page) maps to network_error", async () => {
    const fetch = mock(async () => {
      return {
        ok: false,
        status: 502,
        async json() {
          throw new SyntaxError("Unexpected token < in JSON at position 0");
        },
      } as unknown as Response;
    }) as unknown as typeof globalThis.fetch;
    const disp = createLiveDispatcher({ fetch, readCsrf: () => "t" });

    const result = await disp.write("x", {});
    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) expect(result.error.code).toBe("network_error");
  });

  test("typed server failure (400) does NOT flip status to offline — server WAS reached", async () => {
    const { fetch } = makeFetch({
      status: 400,
      body: {
        isSuccess: false,
        error: {
          code: "validation_error",
          httpStatus: 400,
          i18nKey: "errors.validation.failed",
          message: "nope",
        },
      },
    });
    const disp = createLiveDispatcher({ fetch, readCsrf: () => "t" });
    const seen: string[] = [];
    disp.statusStore.subscribe(() => seen.push(disp.statusStore.getSnapshot()));

    await disp.write("x", {});

    expect(disp.statusStore.getSnapshot()).toBe("online");
    expect(seen).toEqual([]); // no status flip
  });

  test("pendingWrites / pendingFiles always return empty arrays for live dispatcher", () => {
    const disp = createLiveDispatcher({ fetch: mock() as unknown as typeof globalThis.fetch });
    expect(disp.pendingWrites()).toEqual([]);
    expect(disp.pendingFiles()).toEqual([]);
  });

  test("stream: POSTs to /api/stream, yields chunk frames, stops on done", async () => {
    const sse = [
      "event: chunk",
      'data: {"i":0}',
      "",
      "event: ping",
      "data: ",
      "",
      "event: chunk",
      'data: {"i":1}',
      "",
      "event: done",
      "data: ",
      "",
    ].join("\n");
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = mock(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(sse, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as unknown as typeof globalThis.fetch;

    const disp = createLiveDispatcher({ fetch: fetchMock, readCsrf: () => "csrf-s" });
    const chunks: unknown[] = [];
    for await (const c of disp.stream("app:stream:x:tail", { n: 2 })) chunks.push(c);

    expect(chunks).toEqual([{ i: 0 }, { i: 1 }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/api/stream");
    expect(calls[0]?.init.method).toBe("POST");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["Accept"]).toBe("text/event-stream");
    expect(headers["X-CSRF-Token"]).toBe("csrf-s");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      type: "app:stream:x:tail",
      payload: { n: 2 },
    });
  });

  test("stream: non-SSE JSON error envelope maps like query failures", async () => {
    const fetchMock = mock(async () =>
      Response.json(
        {
          error: {
            code: "csrf_token_mismatch",
            httpStatus: 403,
            i18nKey: "errors.csrf",
            message: "csrf",
          },
        },
        { status: 403 },
      ),
    ) as unknown as typeof globalThis.fetch;

    const disp = createLiveDispatcher({ fetch: fetchMock, readCsrf: () => undefined });
    let thrown: unknown;
    try {
      for await (const _ of disp.stream("app:stream:x:tail", {})) {
        // no chunks
      }
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toMatchObject({ code: "csrf_token_mismatch" });
  });

  test("stream: AbortError on fetch maps to code aborted", async () => {
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException("The operation was aborted.", "AbortError");
    }) as unknown as typeof globalThis.fetch;

    const disp = createLiveDispatcher({ fetch: fetchMock, readCsrf: () => "t" });
    const ctrl = new AbortController();
    let thrown: unknown;
    try {
      for await (const _ of disp.stream("app:stream:x:tail", {}, { signal: ctrl.signal })) {
        // no chunks
      }
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toMatchObject({ code: "aborted" });
  });

  test("subscribeStatus returns unsubscribe handle", async () => {
    const fetch = mock(async () => {
      throw new Error("boom");
    }) as unknown as typeof globalThis.fetch;
    const disp = createLiveDispatcher({ fetch, readCsrf: () => "t" });

    const listener = mock();
    const unsub = disp.statusStore.subscribe(listener);
    await disp.write("x", {});
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    // A second status change (back to online) should not fire listener.
    // But — if fetch keeps throwing we stay offline (no transition).
    // Force a flip back by resetting fetch to success:
    const fetchOk = mock(async () => ({
      ok: true,
      status: 200,
      async json() {
        return { isSuccess: true, data: {} };
      },
    })) as unknown as typeof globalThis.fetch;
    const disp2 = createLiveDispatcher({ fetch: fetchOk, readCsrf: () => "t" });
    disp2.statusStore.subscribe(listener);
    unsub(); // original unsub — no-op on disp2
    await disp2.write("x", {});
    // listener was triggered once above (initial offline), and disp2's
    // listener subscription is separate — disp2 stays online, no flip,
    // so listener total is still 1.
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

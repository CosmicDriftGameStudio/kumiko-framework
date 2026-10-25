// HTTP client tests via mock fetch. We want to verify retry behaviour + status
// code routing, NOT a real network call.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { RendererError } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import type { ClientConfig } from "../config";
import { postRender } from "../http-client";
import { installFetchMock } from "./install-fetch-mock";

const CONFIG: ClientConfig = {
  serviceUrl: "http://puppeteer-service:3000",
  authToken: "0123456789abcdef0123456789abcdef",
  requestTimeoutMs: 1000,
  maxRetries: 2,
};

const PAYLOAD = { kind: "document-pdf", html: "<p>x</p>" };

let originalFetch: typeof globalThis.fetch;
let origSetTimeout: typeof setTimeout;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  origSetTimeout = globalThis.setTimeout;
  // Run retry delays immediately — same effect as useFakeTimers
  globalThis.setTimeout = ((fn: () => void) => {
    fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = origSetTimeout;
});

function mockResponse(status: number, body: unknown, contentType = "application/json"): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": contentType },
  });
}

function mockBytes(bytes: Uint8Array, contentType = "application/pdf"): Response {
  // @cast-boundary engine-bridge — Uint8Array is a valid BodyInit at runtime
  // (Bun + Node 22+), but lib.dom.d.ts types BodyInit without TypedArray.
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}

describe("postRender :: Happy-Path", () => {
  test("200 → returns bytes + contentType", async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    installFetchMock(mock().mockResolvedValueOnce(mockBytes(pdfBytes)));
    const result = await postRender(CONFIG, PAYLOAD);
    expect(result.contentType).toBe("application/pdf");
    expect(result.bytes).toEqual(pdfBytes);
  });

  test("fetch called with correct URL + headers + body", async () => {
    const fetchMock = mock().mockResolvedValueOnce(mockBytes(new Uint8Array([1])));
    installFetchMock(fetchMock);
    await postRender(CONFIG, PAYLOAD);
    const [url, opts] = fetchMock.mock.calls[0] as [URL, RequestInit];
    // `internal` egress hands fetch a parsed URL, not the raw string, and
    // forces manual redirect handling after spreading the caller's init.
    expect(String(url)).toBe("http://puppeteer-service:3000/render");
    expect(opts.method).toBe("POST");
    expect(opts.redirect).toBe("manual");
    const headers = opts.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer 0123456789abcdef0123456789abcdef");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(opts.body).toBe(JSON.stringify(PAYLOAD));
  });
});

describe("postRender :: 4xx (no retry)", () => {
  test("400 → RendererError invalid_payload sofort", async () => {
    const fetchMock = mock().mockResolvedValueOnce(
      mockResponse(400, { error: "invalid_payload", details: "missing kind" }),
    );
    installFetchMock(fetchMock);
    await expect(postRender(CONFIG, PAYLOAD)).rejects.toThrow(RendererError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // NO retry
  });

  test("401 → RendererError invalid_payload (token problem, no retry)", async () => {
    const fetchMock = mock().mockResolvedValueOnce(mockResponse(401, { error: "unauthorized" }));
    installFetchMock(fetchMock);
    await expect(postRender(CONFIG, PAYLOAD)).rejects.toThrow(RendererError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("413 (too large) → RendererError sofort", async () => {
    const fetchMock = mock().mockResolvedValueOnce(
      mockResponse(413, { error: "html_too_large", maxBytes: 100, gotBytes: 200 }),
    );
    installFetchMock(fetchMock);
    await expect(postRender(CONFIG, PAYLOAD)).rejects.toThrow(/too_large/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("postRender :: 5xx", () => {
  test("503 → 503 → 200: succeeds on 3. attempt", async () => {
    const pdfBytes = new Uint8Array([0x25]);
    const fetchMock = mock()
      .mockResolvedValueOnce(mockResponse(503, { error: "busy" }))
      .mockResolvedValueOnce(mockResponse(503, { error: "busy" }))
      .mockResolvedValueOnce(mockBytes(pdfBytes));
    installFetchMock(fetchMock);
    const result = await postRender(CONFIG, PAYLOAD);
    expect(result.bytes).toEqual(pdfBytes);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("3x 502 → all retries exhausted, RendererError code=unavailable", async () => {
    const fetchMock = mock().mockResolvedValue(mockResponse(502, { error: "bad gateway" }));
    installFetchMock(fetchMock);
    try {
      await postRender(CONFIG, PAYLOAD);
      expect.unreachable("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(RendererError);
      expect((e as RendererError).code).toBe("unavailable");
      expect((e as RendererError).message).toMatch(
        /puppeteer-service is not reachable at .*: puppeteer-service 502/,
      );
    }
    expect(fetchMock).toHaveBeenCalledTimes(3); // maxRetries=2 → 1 initial + 2 retries
  });

  test("500 render_failed → final RendererError code=other, exactly one fetch", async () => {
    const fetchMock = mock().mockResolvedValue(mockResponse(500, { error: "render_failed" }));
    installFetchMock(fetchMock);
    try {
      await postRender(CONFIG, PAYLOAD);
      expect.unreachable("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(RendererError);
      expect((e as RendererError).code).toBe("other");
      expect((e as RendererError).message).toMatch(/500 render_failed/);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("504 (service timeout) → final, no retry", async () => {
    const fetchMock = mock().mockResolvedValue(mockResponse(504, { error: "render_failed" }));
    installFetchMock(fetchMock);
    await expect(postRender(CONFIG, PAYLOAD)).rejects.toMatchObject({ code: "other" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("postRender :: client timeout", () => {
  test("abort by the request timeout is final, no second render is started", async () => {
    const fetchMock = mock().mockRejectedValue(new DOMException("aborted", "AbortError"));
    installFetchMock(fetchMock);
    await expect(postRender(CONFIG, PAYLOAD)).rejects.toMatchObject({
      code: "unavailable",
      message: "request timeout after 1000ms",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a body that stalls after the headers is aborted by the same timer", async () => {
    const fetchMock = mock().mockImplementation((_url: string, init?: RequestInit) => {
      const stalledBody = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () =>
            controller.error(new DOMException("aborted", "AbortError")),
          );
        },
      });
      return Promise.resolve(new Response(stalledBody, { status: 200 }));
    });
    installFetchMock(fetchMock);
    const timers: Array<() => void> = [];
    globalThis.setTimeout = ((fn: () => void) => {
      timers.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    const pending = postRender(CONFIG, PAYLOAD);
    await new Promise((resolve) => origSetTimeout(resolve, 10));
    for (const fire of timers) fire();
    await expect(pending).rejects.toMatchObject({ code: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("postRender :: network error (with retry)", () => {
  test("fetch throws (network down) → retry, then success", async () => {
    const pdfBytes = new Uint8Array([0x25]);
    const fetchMock = mock()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(mockBytes(pdfBytes));
    installFetchMock(fetchMock);
    const result = await postRender(CONFIG, PAYLOAD);
    expect(result.bytes).toEqual(pdfBytes);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("postRender :: egress policy (serviceUrl validation)", () => {
  test("redirect to another port is rejected, the Bearer token never reaches it", async () => {
    const fetchMock = mock().mockImplementation(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://puppeteer-service:4000/render" },
        }),
    );
    installFetchMock(fetchMock);
    await expect(postRender(CONFIG, PAYLOAD)).rejects.toThrow(RendererError);
    const requested = fetchMock.mock.calls.map((call) => String((call as [URL])[0]));
    expect(requested.length).toBeGreaterThan(0);
    expect(requested.every((url) => url === "http://puppeteer-service:3000/render")).toBe(true);
  });

  test("non-http(s) serviceUrl scheme is rejected, never fetched", async () => {
    const fetchMock = mock().mockResolvedValueOnce(mockBytes(new Uint8Array([1])));
    installFetchMock(fetchMock);
    const config: ClientConfig = { ...CONFIG, serviceUrl: "file:///etc/passwd" };
    // Permanent config error: must fail before the retry loop, not after
    // exhausting all attempts.
    const error = await postRender(config, PAYLOAD).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/unsupported scheme/);
    expect((error as Error).message).not.toMatch(/attempts failed/);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  test("unparseable serviceUrl throws RendererError immediately, no retry", async () => {
    const fetchMock = mock().mockResolvedValueOnce(mockBytes(new Uint8Array([1])));
    installFetchMock(fetchMock);
    const config: ClientConfig = { ...CONFIG, serviceUrl: "not a url" };
    // "is not a URL" only comes from serviceEgress before the retry loop —
    // retry-exhaustion would instead say "all 3 attempts failed".
    await expect(postRender(config, PAYLOAD)).rejects.toThrow(/is not a URL/);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import {
  jsonResponse,
  sentBody,
  stubFetch,
  stubOfflineFetch,
} from "../../../shared/__tests__/fetch-test-utils.ts";
import {
  csrfHeaderFromCookie,
  dispatchQuery,
  dispatchWrite,
  hrefWithoutUrlToken,
  postJson,
  readUrlToken,
} from "../static-client.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("postJson", () => {
  test("posts JSON same-origin, with the locale header and without a CSRF header when anonymous", async () => {
    const seen = stubFetch(() => jsonResponse({ isSuccess: true }));
    const result = await postJson("/api/x", { a: 1 }, { locale: "de" });
    expect(result).toEqual({ kind: "success", data: { isSuccess: true } });
    expect(seen[0]?.url).toBe("/api/x");
    expect(seen[0]?.init?.method).toBe("POST");
    expect(seen[0]?.init?.credentials).toBe("same-origin");
    expect(seen[0]?.init?.headers).toEqual({
      "Content-Type": "application/json",
      "X-Locale": "de",
    });
    expect(sentBody(seen[0])).toEqual({ a: 1 });
  });

  test("a network error becomes the network failure, never an exception", async () => {
    stubOfflineFetch();
    expect(await postJson("/api/x", {})).toEqual({ kind: "failure", reason: "network" });
  });

  test("a structured error yields its detail reason and message", async () => {
    stubFetch(() =>
      jsonResponse(
        {
          error: {
            code: "unprocessable",
            message: "nope",
            details: { reason: "invalid_reset_token" },
          },
        },
        { status: 422 },
      ),
    );
    expect(await postJson("/api/x", {})).toEqual({
      kind: "failure",
      reason: "invalid_reset_token",
      message: "nope",
    });
  });

  test("a string error is the reason; an empty error body is unknown", async () => {
    stubFetch(() => jsonResponse({ error: "invalid_body" }, { status: 400 }));
    expect(await postJson("/api/x", {})).toEqual({ kind: "failure", reason: "invalid_body" });
    stubFetch(() => new Response("<html>", { status: 502 }));
    expect(await postJson("/api/x", {})).toEqual({ kind: "failure", reason: "unknown" });
  });

  test("a validation error only on token is the malformed-token reason", async () => {
    stubFetch(() =>
      jsonResponse(
        { error: { code: "validation_error", details: { fields: [{ path: "token" }] } } },
        { status: 400 },
      ),
    );
    expect(await postJson("/api/x", {})).toEqual({ kind: "failure", reason: "malformed_token" });
  });

  test("a validation error on other fields keeps its code", async () => {
    stubFetch(() =>
      jsonResponse(
        {
          error: {
            code: "validation_error",
            details: { fields: [{ path: "token" }, { path: "newPassword" }] },
          },
        },
        { status: 400 },
      ),
    );
    expect(await postJson("/api/x", {})).toMatchObject({ reason: "validation_error" });
  });

  test("429 reports rate_limited with Retry-After, falling back to the body", async () => {
    stubFetch(() => new Response("{}", { status: 429, headers: { "Retry-After": "42" } }));
    expect(await postJson("/api/x", {})).toEqual({
      kind: "failure",
      reason: "rate_limited",
      retryAfterSeconds: 42,
    });
    stubFetch(() =>
      jsonResponse({ error: { details: { retryAfterSeconds: 7 } } }, { status: 429 }),
    );
    expect(await postJson("/api/x", {})).toEqual({
      kind: "failure",
      reason: "rate_limited",
      retryAfterSeconds: 7,
    });
  });

  test("a 200 envelope with isSuccess false is a failure", async () => {
    stubFetch(() => jsonResponse({ isSuccess: false, error: { code: "boom" } }));
    expect(await postJson("/api/x", {})).toEqual({ kind: "failure", reason: "boom" });
  });
});

describe("dispatchWrite and dispatchQuery", () => {
  test("write posts the envelope to /api/write and unwraps data", async () => {
    const seen = stubFetch(() => jsonResponse({ isSuccess: true, data: { kept: true } }));
    expect(await dispatchWrite("f:write:x", { token: "t" })).toEqual({
      kind: "success",
      data: { kept: true },
    });
    expect(seen[0]?.url).toBe("/api/write");
    expect(sentBody(seen[0])).toEqual({ type: "f:write:x", payload: { token: "t" } });
  });

  test("query posts to /api/query and unwraps data", async () => {
    const seen = stubFetch(() => jsonResponse({ data: { enabled: true } }));
    expect(await dispatchQuery("f:query:x", {})).toEqual({
      kind: "success",
      data: { enabled: true },
    });
    expect(seen[0]?.url).toBe("/api/query");
  });
});

describe("csrfHeaderFromCookie", () => {
  test("echoes the csrf cookie and ignores lookalikes", () => {
    expect(csrfHeaderFromCookie("a=1; kumiko_csrf=abc%20d; b=2")).toEqual({
      "X-CSRF-Token": "abc d",
    });
    expect(csrfHeaderFromCookie("__Host-kumiko_csrf=host")).toEqual({ "X-CSRF-Token": "host" });
    expect(csrfHeaderFromCookie("not_kumiko_csrf=x; kumiko_csrf=")).toEqual({});
    expect(csrfHeaderFromCookie("")).toEqual({});
  });
});

describe("url token", () => {
  test("reads the token from the query or the fragment", () => {
    expect(readUrlToken("https://a.test/p?token=q%2B1&x=1", "query")).toBe("q+1");
    expect(readUrlToken("https://a.test/p#token=f1&x=1", "fragment")).toBe("f1");
    expect(readUrlToken("https://a.test/p?token=q", "fragment")).toBe("");
    expect(readUrlToken("https://a.test/p", "query")).toBe("");
  });

  test("removes only the token and keeps the rest of the address", () => {
    expect(hrefWithoutUrlToken("https://a.test/p?token=q&lang=de#top", "query")).toBe(
      "https://a.test/p?lang=de#top",
    );
    expect(hrefWithoutUrlToken("https://a.test/p?token=q", "query")).toBe("https://a.test/p");
    expect(hrefWithoutUrlToken("https://a.test/p?x=1#token=f&y=2", "fragment")).toBe(
      "https://a.test/p?x=1#y=2",
    );
    expect(hrefWithoutUrlToken("https://a.test/p?x=1#token=f", "fragment")).toBe(
      "https://a.test/p?x=1",
    );
  });

  test("leaves an address without a token untouched", () => {
    expect(hrefWithoutUrlToken("https://a.test/p?x=1", "query")).toBe("https://a.test/p?x=1");
  });
});

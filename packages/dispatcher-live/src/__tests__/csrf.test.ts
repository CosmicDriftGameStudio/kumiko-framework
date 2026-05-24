import { describe, expect, test } from "bun:test";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, readCsrfToken } from "../csrf";

describe("CSRF token extraction", () => {
  test("constants match server-side expectations", () => {
    // If the server renames the cookie or header, these literals must
    // be bumped in sync — see auth-middleware.ts.
    expect(CSRF_COOKIE_NAME).toBe("kumiko_csrf");
    expect(CSRF_HEADER_NAME).toBe("X-CSRF-Token");
  });

  test("reads the token from a cookie string with one entry", () => {
    const token = readCsrfToken("kumiko_csrf=abc-123");
    expect(token).toBe("abc-123");
  });

  test("reads the token from a cookie string with multiple entries", () => {
    const raw = "kumiko_auth=xxx; kumiko_csrf=the-token; tenant=42";
    expect(readCsrfToken(raw)).toBe("the-token");
  });

  test("handles whitespace variations between entries", () => {
    // Browsers typically emit "; " but servers or testing tools can
    // emit a single space, no space, or trailing semicolons.
    expect(readCsrfToken("a=1;kumiko_csrf=x")).toBe("x");
    expect(readCsrfToken("a=1;   kumiko_csrf=x")).toBe("x");
    expect(readCsrfToken("kumiko_csrf=x;")).toBe("x");
  });

  test("decodes percent-encoded values", () => {
    // UUIDs don't need encoding, but a future migration to opaque
    // tokens might. Decoding is the standard cookie-semantic.
    expect(readCsrfToken("kumiko_csrf=a%20b")).toBe("a b");
  });

  test("returns undefined when the cookie is absent", () => {
    expect(readCsrfToken("other=value")).toBeUndefined();
  });

  test("returns undefined for an empty cookie value", () => {
    // `kumiko_csrf=` with no value — treated as "not set", caller will
    // send the request without the header and the server will reject
    // with csrf_token_missing (correct failure mode).
    expect(readCsrfToken("kumiko_csrf=")).toBeUndefined();
  });

  test("returns undefined when no cookieSource and no document", () => {
    // Runs in Node without a document — the safe fallback.
    expect(readCsrfToken()).toBeUndefined();
  });

  test("substring matches don't fool the parser", () => {
    // "not_kumiko_csrf" starts with "not_" — shouldn't be mistaken for
    // the real cookie name. The parser splits on ; first, then on =,
    // then compares the NAME exactly.
    const raw = "not_kumiko_csrf=other; kumiko_csrf=real";
    expect(readCsrfToken(raw)).toBe("real");

    const onlyFake = "not_kumiko_csrf=other";
    expect(readCsrfToken(onlyFake)).toBeUndefined();
  });
});

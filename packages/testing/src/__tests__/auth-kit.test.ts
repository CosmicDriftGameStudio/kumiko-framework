import { describe, expect, test } from "bun:test";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import {
  csrfHeaderFromCookies,
  loginViaApi,
  syntheticClientIpFor,
  totpCode,
} from "../e2e/auth-kit";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "../e2e/constants";

type CapturedPost = {
  readonly path: string;
  readonly options: { headers?: Record<string, string> };
};

function fakeRequestContext(onPost: (call: CapturedPost) => void): APIRequestContext {
  const fakeResponse = {
    ok: () => true,
    status: () => 200,
    text: async () => "{}",
    json: async () => ({}),
  } as APIResponse;
  return {
    post: async (path: string, options?: { headers?: Record<string, string> }) => {
      onPost({ path, options: options ?? {} });
      return fakeResponse;
    },
    // @cast-boundary engine-bridge — test double covers only the subset loginViaApi calls
  } as unknown as APIRequestContext;
}

describe("csrfHeaderFromCookies", () => {
  test("echoes the csrf cookie as the CSRF header", () => {
    const cookies = [
      { name: "kumiko_auth", value: "jwt" },
      { name: CSRF_COOKIE_NAME, value: "csrf-value" },
    ];

    expect(csrfHeaderFromCookies(cookies)).toEqual({ [CSRF_HEADER_NAME]: "csrf-value" });
  });

  test("sends no header when the cookie is absent", () => {
    expect(csrfHeaderFromCookies([{ name: "kumiko_auth", value: "jwt" }])).toEqual({});
    expect(csrfHeaderFromCookies([])).toEqual({});
  });
});

describe("syntheticClientIpFor", () => {
  test("is deterministic for the same email", () => {
    expect(syntheticClientIpFor("a@example.com")).toBe(syntheticClientIpFor("a@example.com"));
  });

  test("differs across emails", () => {
    expect(syntheticClientIpFor("a@example.com")).not.toBe(syntheticClientIpFor("b@example.com"));
  });

  test("stays in the RFC 1918 10.0.0.0/8 private range", () => {
    expect(syntheticClientIpFor("a@example.com")).toMatch(/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
  });
});

describe("loginViaApi", () => {
  test("sends a synthetic per-email X-Forwarded-For header", async () => {
    let captured: CapturedPost | undefined;
    const context = fakeRequestContext((call) => {
      captured = call;
    });

    await loginViaApi(context, { email: "a@example.com", password: "secret" });

    expect(captured?.path).toBe("/api/auth/login");
    expect(captured?.options.headers?.["x-forwarded-for"]).toBe(
      syntheticClientIpFor("a@example.com"),
    );
  });
});

describe("totpCode", () => {
  const RFC6238_SECRET_ASCII = "12345678901234567890";
  const RFC6238_SECRET_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

  test("matches the RFC 6238 SHA-1 vector at T=59s (last six digits of 94287082)", async () => {
    expect(await totpCode(Buffer.from(RFC6238_SECRET_ASCII), 59_000)).toBe("287082");
  });

  test("matches the RFC 6238 vector at T=1111111109s", async () => {
    expect(await totpCode(Buffer.from(RFC6238_SECRET_ASCII), 1_111_111_109_000)).toBe("081804");
  });

  test("a base32 secret yields the same code as its raw bytes", async () => {
    expect(await totpCode(RFC6238_SECRET_BASE32, 59_000)).toBe("287082");
  });
});

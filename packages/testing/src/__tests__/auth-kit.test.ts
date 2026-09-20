import { describe, expect, test } from "bun:test";
import { csrfHeaderFromCookies, totpCode } from "../e2e/auth-kit";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "../e2e/constants";

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

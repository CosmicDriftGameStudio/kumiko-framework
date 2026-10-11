import { describe, expect, test } from "bun:test";
import {
  AUTH_COOKIE_BASE,
  CSRF_COOKIE_BASE,
  HOST_COOKIE_PREFIX,
  isHostPrefixedCookieName,
  sessionCookieName,
  sessionCookieNameCandidates,
  TENANT_COOKIE_BASE,
} from "../session-cookies.js";

describe("sessionCookieName", () => {
  test("secure without domain gets the __Host- prefix", () => {
    expect(sessionCookieName(AUTH_COOKIE_BASE, { secure: true })).toBe(
      `${HOST_COOKIE_PREFIX}${AUTH_COOKIE_BASE}`,
    );
    expect(sessionCookieName(CSRF_COOKIE_BASE, { secure: true, domain: undefined })).toBe(
      `${HOST_COOKIE_PREFIX}${CSRF_COOKIE_BASE}`,
    );
  });

  test("insecure keeps the plain name", () => {
    expect(sessionCookieName(AUTH_COOKIE_BASE, { secure: false })).toBe(AUTH_COOKIE_BASE);
  });

  test("a domain keeps the plain name even when secure", () => {
    expect(sessionCookieName(CSRF_COOKIE_BASE, { secure: true, domain: "example.eu" })).toBe(
      CSRF_COOKIE_BASE,
    );
  });

  test("candidates list the prefixed name first", () => {
    expect(sessionCookieNameCandidates(TENANT_COOKIE_BASE)).toEqual([
      `${HOST_COOKIE_PREFIX}${TENANT_COOKIE_BASE}`,
      TENANT_COOKIE_BASE,
    ]);
  });

  test("isHostPrefixedCookieName tells prefixed from plain", () => {
    expect(isHostPrefixedCookieName(`${HOST_COOKIE_PREFIX}${AUTH_COOKIE_BASE}`)).toBe(true);
    expect(isHostPrefixedCookieName(AUTH_COOKIE_BASE)).toBe(false);
  });
});

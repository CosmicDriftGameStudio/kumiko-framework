import { describe, expect, mock, test } from "bun:test";
import {
  assertNavigableUrl,
  buildLoginRedirectUrl,
  followNextAfterLogin,
  isSafeNextPath,
  readNextFromSearch,
} from "../auth-redirect.js";

describe("isSafeNextPath", () => {
  test.each(["/", "/a", "/a/dashboard?tab=2#section", "/a/path%2F..%2Fx"])(
    "accepts same-origin path %s",
    (path) => {
      expect(isSafeNextPath(path)).toBe(true);
    },
  );

  test.each([
    "//evil.example",
    "//evil.example/path",
    "/\\evil.example",
    "\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/ /evil.example",
    "/./\\evil.example",
    "https://evil.example",
    "http://evil.example/a",
    "javascript:alert(1)",
    "data:text/html,x",
    "a/relative",
    "",
  ])("rejects %j", (candidate) => {
    expect(isSafeNextPath(candidate)).toBe(false);
  });

  test("rejects non-strings", () => {
    expect(isSafeNextPath(undefined)).toBe(false);
    expect(isSafeNextPath(null)).toBe(false);
    expect(isSafeNextPath(42)).toBe(false);
  });
});

describe("readNextFromSearch", () => {
  test("returns a safe next path", () => {
    expect(readNextFromSearch("?next=%2Fa%2Fsettings%3Ftab%3D1")).toBe("/a/settings?tab=1");
  });

  test.each([
    "?next=%2F%2Fevil.example",
    "?next=https%3A%2F%2Fevil.example",
    "?next=javascript%3Aalert(1)",
    "?next=%2F%5Cevil.example",
    "?other=1",
    "",
  ])("returns null for %j", (search) => {
    expect(readNextFromSearch(search)).toBeNull();
  });
});

describe("assertNavigableUrl", () => {
  test("accepts root-relative paths and http(s) URLs", () => {
    expect(() => assertNavigableUrl("/login", "loginUrl")).not.toThrow();
    expect(() => assertNavigableUrl("https://example.com/login", "loginUrl")).not.toThrow();
    expect(() => assertNavigableUrl("http://localhost:3000/login", "loginUrl")).not.toThrow();
  });

  test.each(["javascript:alert(1)", "data:text/html,x", "//evil.example", "login", ""])(
    "rejects %j",
    (url) => {
      expect(() => assertNavigableUrl(url, "loginUrl")).toThrow(/loginUrl must be/);
    },
  );
});

describe("buildLoginRedirectUrl", () => {
  const origin = "https://app.example";

  test("appends next to a same-origin login path as a relative URL", () => {
    expect(buildLoginRedirectUrl("/login", "/a/dash?x=1", origin)).toBe(
      "/login?next=%2Fa%2Fdash%3Fx%3D1",
    );
  });

  test("keeps existing query params of an external login URL", () => {
    expect(buildLoginRedirectUrl("https://example.com/login?lang=de", "/a", origin)).toBe(
      "https://example.com/login?lang=de&next=%2Fa",
    );
  });

  test("never forwards an unsafe return path", () => {
    expect(buildLoginRedirectUrl("/login", "//evil.example", origin)).toBe("/login");
  });
});

describe("followNextAfterLogin", () => {
  function locationAt(pathname: string, search: string) {
    const replace = mock((_url: string): void => {});
    return { location: { pathname, search, replace }, replace };
  }

  test("follows a safe next", () => {
    const { location, replace } = locationAt("/login", "?next=%2Fa%2Fsettings%3Ftab%3D2");

    expect(followNextAfterLogin(location)).toBe(true);
    expect(replace).toHaveBeenCalledWith("/a/settings?tab=2");
  });

  test.each([
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "/\t/evil.example",
    "/a\u0000b",
  ])("rejects the open-redirect candidate %j", (candidate) => {
    const { location, replace } = locationAt("/login", `?next=${encodeURIComponent(candidate)}`);

    expect(followNextAfterLogin(location)).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  test("ignores a missing next and a next pointing at the login page itself", () => {
    for (const search of ["", "?next=%2Flogin%3Fx%3D1"]) {
      const { location, replace } = locationAt("/login", search);
      expect(followNextAfterLogin(location)).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    }
  });
});

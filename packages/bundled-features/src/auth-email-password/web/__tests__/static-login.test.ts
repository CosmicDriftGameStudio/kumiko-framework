import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  appReturnPath,
  forgotPasswordHref,
  loginWithPassword,
  marketingLoginUrl,
  postLoginPath,
  verifyMfaCode,
} from "../static-login.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Seen = { url: string; init: RequestInit | undefined };

function stubFetch(respond: () => Response | Promise<Response>): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), init });
    return respond();
  }) as typeof fetch;
  return seen;
}

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const isAppPath = (pathname: string) => pathname === "/app" || pathname.startsWith("/app/");

describe("loginWithPassword", () => {
  test("posts the same request shape as the SPA login, without a CSRF header", async () => {
    const seen = stubFetch(() => json({ isSuccess: true, token: "t", user: { id: "u" } }));
    await loginWithPassword("a@b.de", "pw");
    expect(seen[0]?.url).toBe("/api/auth/login");
    expect(seen[0]?.init?.method).toBe("POST");
    expect(seen[0]?.init?.credentials).toBe("same-origin");
    expect(seen[0]?.init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(seen[0]?.init?.body).toBe(JSON.stringify({ email: "a@b.de", password: "pw" }));
  });

  test("success carries the landing path only when the server sent one", async () => {
    stubFetch(() =>
      json({ isSuccess: true, token: "t", user: { id: "u" }, landingPath: "/app/x" }),
    );
    expect(await loginWithPassword("a", "b")).toEqual({ kind: "success", landingPath: "/app/x" });
    stubFetch(() => json({ isSuccess: true, token: "t", user: { id: "u" } }));
    expect(await loginWithPassword("a", "b")).toEqual({ kind: "success" });
  });

  test("an MFA-enrolled user gets the challenge token", async () => {
    stubFetch(() => json({ isSuccess: true, mfaRequired: true, challengeToken: "c1" }));
    expect(await loginWithPassword("a", "b")).toEqual({
      kind: "mfa-challenge",
      challengeToken: "c1",
    });
  });

  test("the setup-required flag and the setup-required reason both map to mfa-setup-required", async () => {
    stubFetch(() => json({ isSuccess: true, mfaSetupRequired: true, preauthSetupToken: "p" }));
    expect(await loginWithPassword("a", "b")).toEqual({ kind: "mfa-setup-required" });
    stubFetch(() =>
      json(
        { isSuccess: false, error: { code: "x", details: { reason: "mfa_setup_required" } } },
        { status: 403 },
      ),
    );
    expect(await loginWithPassword("a", "b")).toEqual({ kind: "mfa-setup-required" });
  });

  test("failures keep the structured reason and the lockout countdown", async () => {
    stubFetch(() =>
      json(
        {
          isSuccess: false,
          error: {
            code: "forbidden",
            details: { reason: "account_locked", retryAfterSeconds: 90 },
          },
        },
        { status: 403 },
      ),
    );
    expect(await loginWithPassword("a", "b")).toEqual({
      kind: "failure",
      reason: "account_locked",
      retryAfterSeconds: 90,
    });
    stubFetch(() => json({ isSuccess: false, error: "invalid_body" }, { status: 400 }));
    expect(await loginWithPassword("a", "b")).toEqual({ kind: "failure", reason: "invalid_body" });
  });

  test("429 is rate_limited and reads Retry-After", async () => {
    stubFetch(() => new Response("", { status: 429, headers: { "Retry-After": "30" } }));
    expect(await loginWithPassword("a", "b")).toEqual({
      kind: "failure",
      reason: "rate_limited",
      retryAfterSeconds: 30,
    });
    stubFetch(() => new Response("", { status: 429, headers: { "Retry-After": "soon" } }));
    expect(await loginWithPassword("a", "b")).toEqual({ kind: "failure", reason: "rate_limited" });
  });

  test("a network error and a non-JSON body become failures", async () => {
    stubFetch(() => {
      throw new TypeError("offline");
    });
    expect(await loginWithPassword("a", "b")).toEqual({ kind: "failure", reason: "network" });
    stubFetch(() => new Response("<html>502</html>", { status: 502 }));
    expect(await loginWithPassword("a", "b")).toEqual({ kind: "failure", reason: "login_failed" });
  });
});

describe("verifyMfaCode", () => {
  test("posts challengeToken and code to the MFA verify route", async () => {
    const seen = stubFetch(() => json({ isSuccess: true, token: "t", user: { id: "u" } }));
    expect(await verifyMfaCode("c1", "123456")).toEqual({ kind: "success" });
    expect(seen[0]?.url).toBe("/api/auth/mfa/verify");
    expect(seen[0]?.init?.body).toBe(JSON.stringify({ challengeToken: "c1", code: "123456" }));
    expect(seen[0]?.init?.headers).toEqual({ "Content-Type": "application/json" });
  });

  test("covers success landing path, failure, 429, network and non-JSON", async () => {
    stubFetch(() => json({ isSuccess: true, token: "t", user: {}, landingPath: "/app" }));
    expect(await verifyMfaCode("c", "1")).toEqual({ kind: "success", landingPath: "/app" });
    stubFetch(() => json({ isSuccess: false, error: { code: "invalid_code" } }, { status: 401 }));
    expect(await verifyMfaCode("c", "1")).toEqual({ kind: "failure", reason: "invalid_code" });
    stubFetch(() => new Response("", { status: 429, headers: { "Retry-After": "5" } }));
    expect(await verifyMfaCode("c", "1")).toEqual({
      kind: "failure",
      reason: "rate_limited",
      retryAfterSeconds: 5,
    });
    stubFetch(() => {
      throw new TypeError("offline");
    });
    expect(await verifyMfaCode("c", "1")).toEqual({ kind: "failure", reason: "network" });
    stubFetch(() => new Response("nope", { status: 500 }));
    expect(await verifyMfaCode("c", "1")).toEqual({ kind: "failure", reason: "mfa_verify_failed" });
  });
});

describe("appReturnPath", () => {
  test("accepts an app path with query and hash", () => {
    expect(appReturnPath("/app/x?a=1#h", isAppPath)).toBe("/app/x?a=1#h");
  });

  test.each([
    ["protocol-relative host", "//evil.example/app"],
    ["backslash host", "/\\evil.example"],
    ["control character", "/app/x\n"],
    ["dot segment", "/app/../admin"],
    ["encoded dot segment", "/app/%2e%2e/admin"],
    ["non-app path", "/pricing"],
    ["absolute url", "https://evil.example/app"],
    ["non-string", 42],
  ])("rejects %s", (_name, candidate) => {
    expect(appReturnPath(candidate, isAppPath)).toBeNull();
  });
});

describe("postLoginPath", () => {
  const base = { isAppPath, fallbackPath: "/app" };

  test("a valid next beats the landing path", () => {
    expect(
      postLoginPath({ ...base, search: "?next=%2Fapp%2Fa%3Fx%3D1", landingPath: "/app/l" }),
    ).toBe("/app/a?x=1");
  });

  test("an unsafe or non-app next falls through to the landing path", () => {
    expect(postLoginPath({ ...base, search: "?next=%2Fpricing", landingPath: "/app/l" })).toBe(
      "/app/l",
    );
    expect(postLoginPath({ ...base, search: "?next=%2F%2Fevil", landingPath: "/app/l" })).toBe(
      "/app/l",
    );
  });

  test("an unsafe or non-app landing path falls through to the fallback", () => {
    expect(postLoginPath({ ...base, search: "", landingPath: "//evil" })).toBe("/app");
    expect(postLoginPath({ ...base, search: "", landingPath: "/pricing" })).toBe("/app");
    expect(postLoginPath({ ...base, search: "", landingPath: undefined })).toBe("/app");
  });
});

describe("forgotPasswordHref", () => {
  test("forwards a valid next as returnTo", () => {
    expect(forgotPasswordHref("/forgot", "?next=%2Fapp%2Fa", isAppPath)).toBe(
      "/forgot?returnTo=%2Fapp%2Fa",
    );
  });

  test("leaves the href alone without a valid next", () => {
    expect(forgotPasswordHref("/forgot", "", isAppPath)).toBe("/forgot");
    expect(forgotPasswordHref("/forgot", "?next=%2Fpricing", isAppPath)).toBe("/forgot");
  });
});

describe("marketingLoginUrl", () => {
  const build = marketingLoginUrl({
    localePaths: { default: "/login", byLocale: { de: "/de/login" } },
    isAppPath,
  });

  test("uses the default login path and appends the app return path as next", () => {
    expect(build("en", "/app/x?a=1")).toBe("/login?next=%2Fapp%2Fx%3Fa%3D1");
  });

  test("picks the login path by locale prefix, case-insensitively", () => {
    expect(build("de-DE", "/app/x")).toBe("/de/login?next=%2Fapp%2Fx");
    expect(build("DE", "/app/x")).toBe("/de/login?next=%2Fapp%2Fx");
    expect(build("fr", "/app/x")).toBe("/login?next=%2Fapp%2Fx");
  });

  test("drops the hash", () => {
    expect(build("en", "/app/x#section")).toBe("/login?next=%2Fapp%2Fx");
  });

  test("returns a login path as is, so the login page never bounces to itself", () => {
    expect(build("en", "/de/login/?next=%2Fapp")).toBe("/de/login/");
    expect(build("de", "/login")).toBe("/login");
  });

  test("a non-app return path yields the bare login path", () => {
    expect(build("en", "/pricing")).toBe("/login");
    expect(build("de", "//evil")).toBe("/de/login");
  });
});

describe("static-login import surface", () => {
  test("imports only pure sibling modules", () => {
    const dir = new URL("..", import.meta.url);
    const sources = ["static-login.ts", "login-failure.ts", "login-url.ts"].map((file) =>
      readFileSync(new URL(file, dir), "utf8"),
    );
    const specifiers = sources.flatMap((source) =>
      [...source.matchAll(/^(?:import|export)[^;]*?from\s+"([^"]+)"/gms)].map((m) => m[1]),
    );
    const allowed = new Set(["./login-failure.ts", "./login-url.ts", "./return-path.ts"]);
    expect(specifiers.filter((s) => !allowed.has(s ?? ""))).toEqual([]);
  });
});

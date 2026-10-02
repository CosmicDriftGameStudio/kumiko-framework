// provideSeedTenant is the seedTenant fixture body, extracted so it can be
// driven directly with plain stubs instead of a full Playwright run. The
// regression this guards: a spec with no baseURL (screenshot specs never
// call seedTenant) must not fail during fixture setup — only an actual
// seedTenant() call may throw the "no baseURL" error.
//
// Lives outside src/e2e/ on purpose — bunfig.toml excludes **/e2e/**
// from bun test (that tree is Playwright .spec.ts territory).

import { describe, expect, test } from "bun:test";
import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { syntheticClientIpFor } from "../e2e/auth-kit";
import {
  headersWithClientIp,
  type ProvideSeedTenantDeps,
  perTestClientIpKey,
  providePerTestClientIpContext,
  provideSeedTenant,
  type SeedTenantFixture,
} from "../e2e/seeded-tenant-fixture";

// provideSeedTenant only reaches request/context/playwright once a
// seedTenant() call gets past the baseURL guard — with baseURL undefined
// that never happens, so these stubs stand in for values that are never read.
const UNUSED_API_REQUEST_CONTEXT = {} as APIRequestContext;
const UNUSED_BROWSER_CONTEXT = {} as BrowserContext;
const UNUSED_PLAYWRIGHT = {} as ProvideSeedTenantDeps["playwright"];

describe("provideSeedTenant: baseURL guard", () => {
  test("fixture setup and teardown resolve without a baseURL — only calling seedTenant() throws", async () => {
    let seedTenant: SeedTenantFixture | undefined;

    await provideSeedTenant(
      {
        request: UNUSED_API_REQUEST_CONTEXT,
        context: UNUSED_BROWSER_CONTEXT,
        playwright: UNUSED_PLAYWRIGHT,
        baseURL: undefined,
      },
      async (fixture) => {
        seedTenant = fixture;
      },
    );

    expect(seedTenant).toBeDefined();
    await expect(seedTenant?.()).rejects.toThrow(
      /seedTenant: the Playwright config has no baseURL/,
    );
  });
});

describe("headersWithClientIp", () => {
  const clientIp = "10.1.2.3";

  test("adds the per-test X-Forwarded-For to a same-origin request", () => {
    expect(
      headersWithClientIp(
        { url: "http://app.localhost:4174/api/query", frameUrl: "http://app.localhost:4174/admin" },
        { accept: "application/json" },
        clientIp,
      ),
    ).toEqual({ "x-forwarded-for": clientIp, accept: "application/json" });
  });

  test("leaves cross-origin, frameless and unparsable requests alone", () => {
    const url = "http://api.other.test/api/query";
    expect(headersWithClientIp({ url, frameUrl: "http://app.localhost:4174/" }, {}, clientIp)).toBe(
      undefined,
    );
    expect(headersWithClientIp({ url, frameUrl: undefined }, {}, clientIp)).toBe(undefined);
  });

  test("treats an opaque origin (about:blank) as cross-origin", () => {
    const url = "http://app.localhost/api/query";
    expect(headersWithClientIp({ url, frameUrl: "about:blank" }, {}, clientIp)).toBe(undefined);
  });

  test("leaves requests with an unparsable frame or request URL alone", () => {
    expect(
      headersWithClientIp(
        { url: "http://app.localhost/api/query", frameUrl: "not a url" },
        {},
        clientIp,
      ),
    ).toBe(undefined);
    expect(
      headersWithClientIp({ url: "::", frameUrl: "http://app.localhost/" }, {}, clientIp),
    ).toBe(undefined);
  });

  test("an explicit X-Forwarded-For wins", () => {
    const url = "http://app.localhost/api/query";
    expect(
      headersWithClientIp({ url, frameUrl: url }, { "x-forwarded-for": "10.9.9.9" }, clientIp),
    ).toEqual({ "x-forwarded-for": "10.9.9.9" });
  });
});

describe("perTestClientIpKey", () => {
  test("differs per test, per run and per retry", () => {
    const a = { testId: "spec-a", repeatEachIndex: 0, retry: 0 };
    const b = { testId: "spec-b", repeatEachIndex: 0, retry: 0 };
    expect(perTestClientIpKey(a, "run-1")).not.toBe(perTestClientIpKey(b, "run-1"));
    expect(perTestClientIpKey(a, "run-1")).not.toBe(perTestClientIpKey(a, "run-2"));
    expect(perTestClientIpKey(a, "run-1")).not.toBe(
      perTestClientIpKey({ ...a, retry: 1 }, "run-1"),
    );
  });
});

// Stub-level wiring check (route glob, fallback vs continue, header map keeps
// cookies). Whether a real browser applies the header stays a Playwright concern.
describe("providePerTestClientIpContext", () => {
  type StubRoute = {
    request: () => {
      url: () => string;
      headers: () => Record<string, string>;
      frame: () => { url: () => string };
    };
    fallback: (options?: { headers: Record<string, string> }) => void;
  };
  type RouteHandler = (route: StubRoute) => unknown;
  type FallbackCall = { headers: Record<string, string> } | undefined;

  const testInfoA = { testId: "spec-a", repeatEachIndex: 0, retry: 0 };
  const testInfoB = { testId: "spec-b", repeatEachIndex: 0, retry: 0 };

  async function installRoute(testInfo: typeof testInfoA) {
    const installed: Array<{ glob: string; handler: RouteHandler }> = [];
    const context = {
      route: async (glob: string, handler: RouteHandler) => {
        installed.push({ glob, handler });
      },
    } as unknown as BrowserContext; // @cast-boundary test double, only route() is used
    let used: BrowserContext | undefined;
    await providePerTestClientIpContext(
      { context },
      async (c) => {
        used = c;
      },
      testInfo,
    );
    const first = installed[0];
    if (first === undefined) throw new Error("no route installed");
    return { context, used, installed, handler: first.handler };
  }

  function runHandler(
    handler: RouteHandler,
    url: string,
    frameUrl: string,
    headers: Record<string, string>,
  ): FallbackCall[] {
    const calls: FallbackCall[] = [];
    handler({
      request: () => ({
        url: () => url,
        headers: () => headers,
        frame: () => ({ url: () => frameUrl }),
      }),
      fallback: (options) => {
        calls.push(options);
      },
    });
    return calls;
  }

  test("routes **/api/** and falls back with the per-test IP, keeping cookies", async () => {
    const { context, used, installed, handler } = await installRoute(testInfoA);
    expect(used).toBe(context);
    expect(installed.map((r) => r.glob)).toEqual(["**/api/**"]);

    const calls = runHandler(handler, "http://app.localhost/api/query", "http://app.localhost/", {
      cookie: "session=abc",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers["cookie"]).toBe("session=abc");
    expect(calls[0]?.headers["x-forwarded-for"]).toBe(
      syntheticClientIpFor(perTestClientIpKey(testInfoA)),
    );
  });

  test("tests get different IPs, an explicit X-Forwarded-For wins, cross-origin is untouched", async () => {
    const a = await installRoute(testInfoA);
    const b = await installRoute(testInfoB);
    const url = "http://app.localhost/api/q";
    const frame = "http://app.localhost/";

    const ipA = runHandler(a.handler, url, frame, {})[0]?.headers["x-forwarded-for"];
    const ipB = runHandler(b.handler, url, frame, {})[0]?.headers["x-forwarded-for"];
    expect(ipA).toBeDefined();
    expect(ipA).not.toBe(ipB);

    const explicit = runHandler(a.handler, url, frame, { "x-forwarded-for": "10.9.9.9" });
    expect(explicit[0]?.headers["x-forwarded-for"]).toBe("10.9.9.9");

    const cross = runHandler(a.handler, "http://api.other.test/api/q", frame, {});
    expect(cross).toEqual([undefined]);
  });
});

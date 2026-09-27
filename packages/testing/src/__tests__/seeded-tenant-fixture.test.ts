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
import {
  headersWithClientIp,
  type ProvideSeedTenantDeps,
  perTestClientIpKey,
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
    expect(headersWithClientIp({ url, frameUrl: "about:blank" }, {}, clientIp)).toBe(undefined);
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

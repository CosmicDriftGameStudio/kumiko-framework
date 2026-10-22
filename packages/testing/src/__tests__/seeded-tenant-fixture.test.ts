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
import { DEFAULT_MAX_APP_BOOTS_PER_TEST as MAX_APP_BOOTS_PER_TEST } from "../e2e/app-boot-budget";
import { syntheticClientIpFor } from "../e2e/auth-kit";
import {
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

// Stub-level wiring check. Whether a real browser applies the header and keeps
// its HTTP cache stays a Playwright concern (e2e/client-ip.spec.ts).
describe("providePerTestClientIpContext", () => {
  type RequestListener = (request: { url: () => string }) => void;
  type TestInfoStub = Parameters<typeof providePerTestClientIpContext>[2];

  const passing = {
    testId: "spec-a",
    repeatEachIndex: 0,
    retry: 0,
    status: "passed",
    expectedStatus: "passed",
  } as const;

  function stubContext(pages: Array<{ isClosed: () => boolean; close: () => Promise<void> }> = []) {
    const extraHeaders: Array<Record<string, string>> = [];
    const listeners: RequestListener[] = [];
    let routeCalls = 0;
    const context = {
      setExtraHTTPHeaders: async (headers: Record<string, string>) => {
        extraHeaders.push(headers);
      },
      route: async () => {
        routeCalls += 1;
      },
      on: (event: string, listener: RequestListener) => {
        if (event === "request") listeners.push(listener);
      },
      pages: () => pages,
    } as unknown as BrowserContext; // @cast-boundary test double, only the used members exist
    const fire = (url: string) => {
      for (const listener of listeners) listener({ url: () => url });
    };
    return { context, extraHeaders, fire, routeCalls: () => routeCalls };
  }

  test("sets the per-test IP as an extra header and registers no route", async () => {
    const a = stubContext();
    const b = stubContext();
    await providePerTestClientIpContext(
      { context: a.context, maxAppBootsPerTest: MAX_APP_BOOTS_PER_TEST },
      async () => {},
      passing,
    );
    await providePerTestClientIpContext(
      { context: b.context, maxAppBootsPerTest: MAX_APP_BOOTS_PER_TEST },
      async () => {},
      {
        ...passing,
        testId: "spec-b",
      },
    );

    expect(a.extraHeaders).toEqual([
      { "x-forwarded-for": syntheticClientIpFor(perTestClientIpKey(passing)) },
    ]);
    expect(b.extraHeaders[0]).not.toEqual(a.extraHeaders[0]);
    expect(a.routeCalls()).toBe(0);
  });

  async function runWithBoots(
    bootCount: number,
    testInfo: TestInfoStub,
    limit = MAX_APP_BOOTS_PER_TEST,
  ) {
    const stub = stubContext();
    await providePerTestClientIpContext(
      { context: stub.context, maxAppBootsPerTest: limit },
      async () => {
        for (let i = 0; i < bootCount; i += 1) stub.fire("http://app.localhost/api/schema");
        stub.fire("http://app.localhost/api/query");
      },
      testInfo,
    );
  }

  test("a test within the app boot budget passes", async () => {
    await expect(runWithBoots(MAX_APP_BOOTS_PER_TEST, passing)).resolves.toBeUndefined();
  });

  test("a test over the app boot budget fails with count, budget and the seeding hint", async () => {
    await expect(runWithBoots(MAX_APP_BOOTS_PER_TEST + 1, passing)).rejects.toThrow(
      `booted the app ${MAX_APP_BOOTS_PER_TEST + 1} times (GET /api/schema), budget is ${MAX_APP_BOOTS_PER_TEST}. Seed through tenant.api`,
    );
  });

  test("an already failed test keeps its own failure instead of the budget error", async () => {
    await expect(
      runWithBoots(MAX_APP_BOOTS_PER_TEST + 5, { ...passing, status: "failed" }),
    ).resolves.toBeUndefined();
  });

  test("a raised maxAppBootsPerTest option allows more boots", async () => {
    await expect(runWithBoots(40, passing, 100)).resolves.toBeUndefined();
  });

  test("closes pages left open by the test", async () => {
    const closedPages: string[] = [];
    const stub = stubContext([
      {
        isClosed: () => false,
        close: async () => {
          closedPages.push("popup");
        },
      },
      {
        isClosed: () => true,
        close: async () => {
          closedPages.push("already-closed");
        },
      },
    ]);
    await providePerTestClientIpContext(
      { context: stub.context, maxAppBootsPerTest: MAX_APP_BOOTS_PER_TEST },
      async () => {},
      passing,
    );
    expect(closedPages).toEqual(["popup"]);
  });
});

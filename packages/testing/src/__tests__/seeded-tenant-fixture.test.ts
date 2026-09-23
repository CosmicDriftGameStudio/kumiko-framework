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
  type ProvideSeedTenantDeps,
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

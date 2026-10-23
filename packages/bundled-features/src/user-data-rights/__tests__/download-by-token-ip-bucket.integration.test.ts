// Regression: the `/user-export/by-token` httpRoute wrapper re-dispatches
// to `download-by-token` (rateLimit: { per: "ip", limit: 30 }) via an internal
// `app.fetch(new Request(...))` call. That internal request has no socket of
// its own, so the L3 per-ip bucket only sees a real client IP if the wrapper
// hands it one explicitly. Before the fix it forwarded a synthetic single-hop
// X-Forwarded-For header — which the shared client-ip resolver only honours
// at exactly `trustedProxyHops: 1` (see client-ip.ts). At the framework
// default (0) the header is ignored outright, and at >=2 a single-entry XFF
// is always short, so both cases fell back to the shared "unknown" bucket:
// one caller could exhaust the 30/min cap for every anonymous downloader.
// The fix passes the already-resolved `clientIp` straight through as the
// internal request's env (2nd `app.fetch` arg), independent of hop count.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigAccessorFactory } from "../../config/feature.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createFileFoundationFeature } from "../../file-foundation/index.ts";
import { createFileProviderInMemoryFeature } from "../../file-provider-inmemory/index.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { tenantMembershipEntity } from "../../tenant/membership-table.ts";
import { createUserFeature } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import { exportDownloadTokenEntity } from "../schema/download-token.ts";
import { exportJobEntity } from "../schema/export-job.ts";

const tenant = testTenantId(1);

async function buildStack(trustedProxyHops: number): Promise<TestStack> {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const resolver = createConfigResolver({ cipher: encryption });

  const stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createFileFoundationFeature(),
      createFileProviderInMemoryFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature(),
    ],
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
    anonymousAccess: { defaultTenantId: tenant },
    trustedProxyHops,
  });
  await unsafeCreateEntityTable(stack.db, exportJobEntity);
  await unsafeCreateEntityTable(stack.db, exportDownloadTokenEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafePushTables(stack.db, { configValuesTable });
  await unsafeCreateEntityTable(stack.db, tenantMembershipEntity);
  return stack;
}

// Rate-limit runs before the handler body (dispatch-query.ts: feature-gate →
// rate-limit → access → validation → handler), so a garbage token still
// consumes the bucket and lets the test avoid seeding a real export job —
// each call 404s (download.notFound) until the bucket is exhausted, then 429.
async function postByToken(
  stack: TestStack,
  headers: Record<string, string>,
  socketAddress?: string,
): Promise<Response> {
  const request = new Request("http://test/user-export/by-token", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ token: "not-a-real-token" }),
  });
  return socketAddress ? stack.app.fetch(request, socketAddress) : stack.app.fetch(request);
}

async function exhaustBucket(
  stack: TestStack,
  headers: Record<string, string>,
  socketAddress?: string,
): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const res = await postByToken(stack, headers, socketAddress);
    expect(res.status).toBe(404);
  }
}

describe("download-by-token IP bucket — trustedProxyHops: 0 (socket-only)", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await buildStack(0);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("two distinct callers each get their own 30/min bucket, not a shared one", async () => {
    // hops=0 ignores X-Forwarded-For outright — distinct callers are
    // simulated via distinct socket addresses (2nd app.fetch arg) on the
    // OUTER request; a spoofed XFF must have no effect at all.
    const spoofedHeaders = { "x-forwarded-for": "ignored-at-hops-0" };
    await exhaustBucket(stack, spoofedHeaders, "203.0.113.10");
    const blocked = await postByToken(stack, spoofedHeaders, "203.0.113.10");
    expect(blocked.status).toBe(429);

    // A second caller (different socket) must not inherit caller A's
    // exhausted bucket, even though it sends the exact same forged XFF.
    const first = await postByToken(stack, spoofedHeaders, "203.0.113.20");
    expect(first.status).toBe(404);
  });
});

describe("download-by-token IP bucket — trustedProxyHops: 2", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await buildStack(2);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("two distinct callers (resolved via a 2-hop XFF chain) each get their own bucket", async () => {
    // entries[length-hops] is the real client: index 1 of a 3-entry chain.
    const callerA = { "x-forwarded-for": "client-forged, 10.1.1.1, 10.0.0.9" };
    const callerB = { "x-forwarded-for": "client-forged, 10.2.2.2, 10.0.0.9" };

    await exhaustBucket(stack, callerA);
    const blocked = await postByToken(stack, callerA);
    expect(blocked.status).toBe(429);

    const first = await postByToken(stack, callerB);
    expect(first.status).toBe(404);
  });
});

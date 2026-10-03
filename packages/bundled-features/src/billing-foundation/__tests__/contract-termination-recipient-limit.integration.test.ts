// Per-recipient limit on the public § 312k declaration (additionalRateLimits):
// a botnet rotating IPs must not flood one address with confirmation mails.
// Real HTTP, real Redis rate limiter; the client IP comes from X-Forwarded-For.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createSystemUser,
  defineFeature,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { seedRow } from "@cosmicdrift/kumiko-framework/testing";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { Redis } from "ioredis";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.js";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.js";
import { createConfigFeature } from "../../config/index.js";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.js";
import { notificationPreferenceEntity } from "../../delivery/tables.js";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.js";
import { createRendererSimpleFeature, simpleRenderer } from "../../renderer-simple/index.js";
import { createTemplateResolverApi } from "../../template-resolver/api.js";
import { TEXT_BLOCK_KIND } from "../../template-resolver/constants.js";
import { createTemplateResolverFeature } from "../../template-resolver/feature.js";
import { templateResourceEntity, templateResourcesTable } from "../../template-resolver/table.js";
import { TenantHandlers } from "../../tenant/constants.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.js";
import { createUserFeature } from "../../user/feature.js";
import { UserHandlers } from "../../user/index.js";
import { userEntity } from "../../user/schema/user.js";
import {
  SubscriptionEventTypes,
  SubscriptionFoundationHandlers,
  SubscriptionStatuses,
} from "../constants.js";
import { createBillingFoundationFeature } from "../feature.js";
import type {
  BillingPlanCatalog,
  ConsumerProtectionOptions,
  SubscriptionEvent,
  SubscriptionProviderPlugin,
} from "../types.js";
import { createSubscriptionWebhookRoute } from "../webhook-handler.js";

const PROVIDER = "mock-recipient-limit-provider";
const TERMS_SLUG = "billing-terms";
const ANONYMOUS_TENANT = testTenantId(8300);
const RATE_LIMIT_KEY_PATTERN = "kumiko:rl:payload+handler:*";

const consumerProtection: ConsumerProtectionOptions = {
  termsTextBlock: TERMS_SLUG,
  vatNote: { de: "Preise inkl. USt.", en: "Prices include VAT." },
  operatorEmail: "billing@example.com",
  legalLinks: {
    terms: "/legal/terms",
    withdrawal: "/legal/withdrawal",
    privacy: "https://example.com/privacy",
  },
};

const catalog: BillingPlanCatalog = {
  plans: ["starter", "pro"],
  tierLabelKey: (tier) => `plan.${tier}.label`,
  benefits: () => [],
  resolveCurrentTier: async () => "free",
  viewRoles: ["TenantAdmin", "SystemAdmin"],
  successPath: "/billing/success",
  cancelPath: "/billing/cancel",
  providerName: PROVIDER,
};

const emailTransport = createInMemoryTransport();

const mockProviderFeature = defineFeature("test-mock-recipient-limit-provider", (r) => {
  r.requires("billing-foundation");
  const plugin: SubscriptionProviderPlugin = {
    verifyAndParseWebhook: async (rawBody) => JSON.parse(rawBody) as SubscriptionEvent | null,
    priceToTier: { price_starter: "starter", price_pro: "pro" },
    cancelSubscription: async () => {},
  };
  r.useExtension("subscriptionProvider", PROVIDER, plugin);
});

let stack: TestStack;
let ipCounter = 0;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createDeliveryFeature(),
      createRendererSimpleFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        renderer: simpleRenderer,
        resolveEmail: async () => "unused@test.local",
      }),
      createBillingFoundationFeature({
        baseUrl: "https://app.example.com",
        catalog,
        consumerProtection,
      }),
      mockProviderFeature,
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      templateResolver: createTemplateResolverApi(deps.db),
    }),
    extraRoutes: [createSubscriptionWebhookRoute()],
    anonymousAccess: { defaultTenantId: ANONYMOUS_TENANT },
    trustedProxyHops: 1,
    jobs: { consumerLane: "worker", queueNamePrefix: `recipient-limit-${generateId()}` },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
  await unsafeCreateEntityTable(stack.db, notificationPreferenceEntity);
  await seedRow(stack.db, templateResourcesTable, {
    tenantId: SYSTEM_TENANT_ID,
    slug: TERMS_SLUG,
    kind: TEXT_BLOCK_KIND,
    locale: "de",
    scope: "system",
    status: "active",
    content: "AGB",
    contentFormat: "markdown",
    variableSchema: JSON.stringify({}),
    linkedResources: JSON.stringify({}),
    parentTemplateId: null,
    insertedById: "test",
    modifiedById: "test",
  });
});

afterAll(async () => {
  await stack.cleanup();
});

async function withRawRedis<T>(run: (raw: Redis) => Promise<T>): Promise<T> {
  const raw = new Redis(stack.redis.redisUrl);
  try {
    return await run(raw);
  } finally {
    raw.disconnect();
  }
}

// Keys come back with the stack's per-file prefix already included.
async function scanKeys(pattern: string): Promise<string[]> {
  return withRawRedis(async (raw) => {
    const keys: string[] = [];
    for await (const batch of raw.scanStream({
      match: `${stack.redis.keyPrefix}${pattern}`,
      count: 500,
    })) {
      keys.push(...(batch as string[]));
    }
    return keys;
  });
}

beforeEach(async () => {
  emailTransport.sent.length = 0;
  // Rate-limit state from the previous test must not leak into this one.
  await withRawRedis(async (raw) => {
    const stale = await scanKeys("kumiko:rl:*");
    if (stale.length > 0) await raw.del(...stale);
  });
});

function nextClientIp(): string {
  ipCounter += 1;
  return `10.83.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

async function declare(email: string): Promise<Response> {
  return stack.app.request("/api/write", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": nextClientIp() },
    body: JSON.stringify({
      type: SubscriptionFoundationHandlers.requestContractTermination,
      payload: {
        declarationType: "termination",
        terminationKind: "ordinary",
        name: "Zebra Quirkmann",
        email,
        locale: "de",
      },
    }),
  });
}

async function seedMatchingContract(email: string): Promise<void> {
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    { email, passwordHash: "not-a-real-hash", displayName: "Declarant" },
    TestUsers.systemAdmin,
  );
  await stack.http.writeOk(
    TenantHandlers.addMember,
    { userId: created.id, tenantId: testTenantId(8301), roles: ["TenantAdmin"] },
    createSystemUser(TestUsers.systemAdmin.tenantId, ["SystemAdmin"]),
  );
  const event: SubscriptionEvent = {
    providerEventId: "evt_recipient_limit",
    providerName: PROVIDER,
    type: SubscriptionEventTypes.created,
    tenantId: testTenantId(8301),
    providerCustomerId: "cus_recipient_limit",
    providerSubscriptionId: "sub_recipient_limit",
    status: SubscriptionStatuses.active,
    tier: "pro",
    currentPeriodEnd: "2026-11-02T00:00:00Z",
  };
  const res = await stack.app.request(`/api/subscription/webhook/${PROVIDER}`, {
    method: "POST",
    body: JSON.stringify(event),
    headers: { "stripe-signature": "test_sig" },
  });
  expect(res.status).toBe(200);
}

type LimitedBody = {
  error: {
    code: string;
    i18nKey: string;
    details: { limit: number; windowSeconds: number; remaining: number };
  };
};

// The bucket name (it carries the address digest), request id and timestamps
// legitimately differ per request; everything a caller could use to tell a
// matched address from an unmatched one must not.
function distinguishingParts(body: LimitedBody) {
  const { code, i18nKey, details } = body.error;
  return {
    code,
    i18nKey,
    limit: details.limit,
    windowSeconds: details.windowSeconds,
    remaining: details.remaining,
  };
}

describe("per-recipient limit on request-contract-termination", () => {
  test("a fourth declaration for one address is rejected even from a fresh IP", async () => {
    const email = "flooded@example.com";
    for (let i = 0; i < 3; i += 1) {
      expect((await declare(email)).status).toBe(200);
    }
    const fourth = await declare(email);
    expect(fourth.status).toBe(429);
    expect(((await fourth.json()) as LimitedBody).error.code).toBe("rate_limited");
    await stack.drainJobs();
    expect(emailTransport.sent.filter((mail) => mail.to === email)).toHaveLength(3);
  });

  test("a matched and an unmatched address behave identically at the limit", async () => {
    const hit = "hit@example.com";
    const miss = "miss@example.com";
    await seedMatchingContract(hit);
    const outcomes: Record<string, { statuses: number[]; limitedBody: LimitedBody | undefined }> =
      {};
    for (const email of [hit, miss]) {
      const statuses: number[] = [];
      let limitedBody: LimitedBody | undefined;
      for (let i = 0; i < 4; i += 1) {
        const res = await declare(email);
        statuses.push(res.status);
        if (res.status === 429) limitedBody = (await res.json()) as LimitedBody;
      }
      outcomes[email] = { statuses, limitedBody };
    }
    expect(outcomes[hit]?.statuses).toEqual([200, 200, 200, 429]);
    expect(outcomes[miss]?.statuses).toEqual(outcomes[hit]?.statuses ?? []);
    const hitBody = outcomes[hit]?.limitedBody;
    const missBody = outcomes[miss]?.limitedBody;
    if (!hitBody || !missBody) throw new Error("expected a 429 body for both addresses");
    expect(distinguishingParts(missBody)).toEqual(distinguishingParts(hitBody));
  });

  test("case variants of one address share a single bucket", async () => {
    expect((await declare("Foo@Example.com")).status).toBe(200);
    expect((await declare("foo@example.com")).status).toBe(200);
    expect((await declare("FOO@EXAMPLE.COM")).status).toBe(200);
    expect((await declare("foo@example.com")).status).toBe(429);
  });

  test("Redis holds neither the address nor its local part in any bucket key", async () => {
    await declare("secretlocal@example.com");
    const keys = await scanKeys(RATE_LIMIT_KEY_PATTERN);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key.toLowerCase()).not.toContain("secretlocal");
      expect(key.toLowerCase()).not.toContain("example.com");
    }
  });
});

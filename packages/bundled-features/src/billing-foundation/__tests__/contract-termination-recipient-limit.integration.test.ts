// Per-recipient cap on the receipt mail of the public § 312k declaration: a botnet
// rotating IPs must not flood one address, yet the declaration is never refused.
// Real HTTP, real Redis rate limiter; the client IP comes from X-Forwarded-For.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createSystemUser,
  defineFeature,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import { seedRow } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { Redis } from "ioredis";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.ts";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.ts";
import { notificationPreferenceEntity } from "../../delivery/tables.ts";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.ts";
import { createTemplateResolverApi } from "../../template-resolver/api.ts";
import { TEXT_BLOCK_KIND } from "../../template-resolver/constants.ts";
import { createTemplateResolverFeature } from "../../template-resolver/feature.ts";
import { seedNotificationTemplates } from "../../template-resolver/seeding.ts";
import { templateResourceEntity, templateResourcesTable } from "../../template-resolver/table.ts";
import { TenantHandlers } from "../../tenant/constants.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { createUserFeature } from "../../user/feature.ts";
import { UserHandlers } from "../../user/index.ts";
import { userEntity } from "../../user/schema/user.ts";
import {
  SubscriptionEventTypes,
  SubscriptionFoundationHandlers,
  SubscriptionStatuses,
} from "../constants.ts";
import { createBillingFoundationFeature } from "../feature.ts";
import type {
  BillingPlanCatalog,
  ConsumerProtectionOptions,
  SubscriptionEvent,
  SubscriptionProviderPlugin,
} from "../types.ts";
import { createSubscriptionWebhookRoute } from "../webhook-handler.ts";

const PROVIDER = "mock-recipient-limit-provider";
const TERMS_SLUG = "billing-terms";
const ANONYMOUS_TENANT = testTenantId(8300);
const RATE_LIMIT_KEY_PATTERN = "kumiko:rl:termination-receipt:*";

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
  r.requires({ features: ["billing-foundation"] });
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
      createRendererMailHtmlFeature(),
      createDeliveryFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
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
  await seedNotificationTemplates(stack.db, stack.registry);
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

function receiptMailsTo(address: string) {
  return emailTransport.sent.filter((mail) => mail.to === address);
}

function operatorMails() {
  return emailTransport.sent.filter((mail) => mail.to === consumerProtection.operatorEmail);
}

describe("per-recipient receipt limit on request-contract-termination", () => {
  test("the declaration is always accepted, only the fourth receipt mail is withheld", async () => {
    const email = "flooded@example.com";
    for (let i = 0; i < 4; i += 1) {
      expect((await declare(email)).status).toBe(200);
    }
    await stack.drainJobs();
    expect(receiptMailsTo(email)).toHaveLength(3);
    // Three unmatched notices plus the fourth that reports the withheld receipt.
    const notices = operatorMails();
    expect(notices).toHaveLength(4);
    expect(notices.filter((mail) => mail.html.includes("Keine Eingangsbestätigung"))).toHaveLength(
      1,
    );
  });

  test("a matched and an unmatched address behave identically at the limit", async () => {
    const hit = "hit@example.com";
    const miss = "miss@example.com";
    await seedMatchingContract(hit);
    for (const email of [hit, miss]) {
      for (let i = 0; i < 4; i += 1) {
        expect((await declare(email)).status).toBe(200);
      }
    }
    await stack.drainJobs();
    expect(receiptMailsTo(hit)).toHaveLength(3);
    expect(receiptMailsTo(miss)).toHaveLength(3);
  });

  test("case variants and plus-tags of one address share a single bucket", async () => {
    for (const email of ["Foo@Example.com", "foo@example.com", "FOO+news@EXAMPLE.COM"]) {
      expect((await declare(email)).status).toBe(200);
    }
    expect((await declare("foo@example.com")).status).toBe(200);
    await stack.drainJobs();
    const received = emailTransport.sent.filter(
      (mail) => mail.to.toLowerCase().replace(/\+news/, "") === "foo@example.com",
    );
    expect(received).toHaveLength(3);
  });

  test("the receipt carries no free text from the declarant", async () => {
    const response = await stack.app.request("/api/write", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": nextClientIp() },
      body: JSON.stringify({
        type: SubscriptionFoundationHandlers.requestContractTermination,
        payload: {
          declarationType: "termination",
          terminationKind: "extraordinary",
          name: "Zebra Quirkmann",
          email: "freetext@example.com",
          customerReference: "ref-needle-4711",
          reason: "reason-needle-4711 http://evil.example",
          locale: "de",
        },
      }),
    });
    expect(response.status).toBe(200);
    await stack.drainJobs();
    const [receipt] = receiptMailsTo("freetext@example.com");
    expect(receipt?.html).toBeDefined();
    for (const needle of ["Zebra", "ref-needle", "reason-needle", "evil.example"]) {
      expect(receipt?.html).not.toContain(needle);
    }
    expect(
      operatorMails()
        .map((mail) => mail.html)
        .join("\n"),
    ).toContain("reason-needle-4711");
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

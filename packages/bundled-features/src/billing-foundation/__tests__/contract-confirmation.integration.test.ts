// § 312f contract confirmation: consent recorded through real HTTP,
// provider webhooks through the real signature extraRoute, the mail captured by
// the in-memory email transport after the job cascade drained.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { asRawClient } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import {
  expectError,
  expectSuccess,
  resetTestTables,
  seedRow,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.ts";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigAccessorFactory } from "../../config/feature.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.ts";
import { notificationPreferenceEntity } from "../../delivery/tables.ts";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.ts";
import { createTemplateResolverApi } from "../../template-resolver/api.ts";
import { createTemplateResolverFeature } from "../../template-resolver/feature.ts";
import { TemplateResolverHandlers } from "../../template-resolver/index.ts";
import { seedNotificationTemplates } from "../../template-resolver/seeding.ts";
import { templateResourceEntity, templateResourcesTable } from "../../template-resolver/table.ts";
import { SYSTEM_TENANT_ID, TEXT_BLOCK_KIND } from "../../template-resolver/web/constants.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { createUserFeature } from "../../user/feature.ts";
import { UserHandlers } from "../../user/index.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { paymentAggregateId, subscriptionAggregateId } from "../aggregate-id.ts";
import { CONSENT_TEXTS, consentTextVersion } from "../consumer-protection/consent-text.ts";
import {
  CHECKOUT_CONSENT_RECORDED_EVENT_QN,
  CONTRACT_CONFIRMATION_ISSUED_EVENT_QN,
} from "../events.ts";
import { createBillingFoundationFeature } from "../feature.ts";
import type {
  BillingPlanCatalog,
  ConsumerProtectionOptions,
  PaymentEvent,
  SubscriptionEvent,
  SubscriptionProviderPlugin,
} from "../types.ts";
import {
  BillingEventKinds,
  SubscriptionEventTypes,
  SubscriptionFoundationHandlers,
  type SubscriptionStatus,
  SubscriptionStatuses,
} from "../web/constants.ts";
import { createSubscriptionWebhookRoute } from "../webhook-handler.ts";

const PROVIDER = "mock-confirm-provider";
const TERMS_SLUG = "billing-terms";
const TERMS_DE = "Allgemeine Geschäftsbedingungen, Fassung 1";
const TERMS_EN = "General terms and conditions, version 1";
const BUYER_EMAIL = "buyer@example.com";

const consumerProtection: ConsumerProtectionOptions = {
  termsTextBlock: TERMS_SLUG,
  vatNote: { de: "Preise inkl. USt.", en: "Prices include VAT." },
  operatorEmail: "billing@example.com",
  oneOffItemLabel: async (_ctx, priceId) =>
    priceId === "price_topup"
      ? {
          labelKey: "test-mock-confirm-provider:credits.pack.label",
          params: { count: 500 },
        }
      : undefined,
  legalLinks: {
    terms: "/legal/terms",
    withdrawal: "/legal/withdrawal",
    privacy: "https://example.com/privacy",
  },
};

const catalog: BillingPlanCatalog = {
  plans: ["starter", "pro"],
  // Server-side i18n only resolves keys qualified with the registering feature.
  tierLabelKey: (tier) => `test-mock-confirm-provider:plan.${tier}.label`,
  benefits: () => [],
  resolveCurrentTier: async () => "free",
  viewRoles: ["TenantAdmin", "SystemAdmin"],
  successPath: "/billing/success",
  cancelPath: "/billing/cancel",
  providerName: PROVIDER,
};

const emailTransport = createInMemoryTransport();
const configResolver = createConfigResolver();
let lastConsentId: string | undefined;

const mockProviderFeature = defineFeature("test-mock-confirm-provider", (r) => {
  r.requires({ features: ["billing-foundation"] });
  r.translations({
    keys: {
      "plan.pro.label": { en: "Pro plan" },
      "credits.pack.label": { en: "{count} credits" },
    },
  });
  const plugin: SubscriptionProviderPlugin = {
    verifyAndParseWebhook: async (rawBody) =>
      JSON.parse(rawBody) as SubscriptionEvent | PaymentEvent | null,
    priceToTier: { price_starter: "starter", price_pro: "pro" },
    oneOffPriceIds: ["price_topup"],
    retrievePrices: async (_ctx, priceIds) =>
      [
        {
          priceId: "price_starter",
          unitAmount: 900,
          currency: "eur",
          interval: "month" as const,
          intervalCount: 1,
          active: true,
          metadata: {},
        },
        {
          priceId: "price_pro",
          unitAmount: 1900,
          currency: "eur",
          interval: "month" as const,
          intervalCount: 1,
          active: true,
          metadata: {},
        },
        {
          priceId: "price_topup",
          unitAmount: 500,
          currency: "eur",
          interval: null,
          intervalCount: null,
          active: true,
          metadata: {},
        },
      ].filter((p) => priceIds.includes(p.priceId)),
    createCheckoutSession: async (_ctx, options) => {
      lastConsentId = options.consentId;
      return { url: `https://mock.example/checkout/${options.priceId}` };
    },
    previewPlanSwitch: async () => ({
      amountDueNow: 667,
      tax: 106,
      currency: "eur",
      credit: 333,
      effectiveAt: "2026-11-01T10:00:00Z",
    }),
    applyPlanSwitch: async (_ctx, options) => {
      lastConsentId = options.consentId;
    },
  };
  r.useExtension("subscriptionProvider", PROVIDER, plugin);
});

let stack: TestStack;

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
      templateResolver: createTemplateResolverApi(deps.db, deps.registry),
      configResolver: configResolver,
      _configAccessorFactory: createConfigAccessorFactory(deps.registry, configResolver),
    }),
    extraRoutes: [createSubscriptionWebhookRoute()],
    jobs: { consumerLane: "worker", queueNamePrefix: `contract-confirmation-${generateId()}` },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
  await unsafeCreateEntityTable(stack.db, notificationPreferenceEntity);
  await unsafePushTables(stack.db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  emailTransport.sent.length = 0;
  lastConsentId = undefined;
  await asRawClient(stack.db).unsafe(
    `TRUNCATE kumiko_events, read_subscriptions, read_payments CASCADE`,
  );
  await resetTestTables(stack.db, [userTable, templateResourcesTable]);
  await seedTerms("de", TERMS_DE);
  await seedNotificationTemplates(stack.db, stack.registry);
  await seedTerms("en", TERMS_EN);
});

async function seedTerms(locale: string, content: string): Promise<void> {
  await seedRow(stack.db, templateResourcesTable, {
    tenantId: SYSTEM_TENANT_ID,
    slug: TERMS_SLUG,
    kind: TEXT_BLOCK_KIND,
    locale,
    scope: "system",
    status: "active",
    content,
    contentFormat: "markdown",
    variableSchema: JSON.stringify({}),
    linkedResources: JSON.stringify({}),
    parentTemplateId: null,
    insertedById: "test",
    modifiedById: "test",
  });
}

async function createBuyer(tenantNumber: number, timezone?: string) {
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    {
      email: BUYER_EMAIL,
      passwordHash: "not-a-real-hash",
      displayName: "Buyer",
      ...(timezone !== undefined && { timezone }),
    },
    TestUsers.systemAdmin,
  );
  return createTestUser({
    id: created.id,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

function consentFor(locale: "de" | "en") {
  return {
    earlyPerformanceRequested: true,
    withdrawalLossAcknowledged: true,
    consentTextVersion: consentTextVersion(locale),
    locale,
  };
}

async function recordSubscriptionConsent(
  buyer: ReturnType<typeof createTestUser>,
  locale: "de" | "en",
): Promise<string> {
  await stack.http.writeOk(
    SubscriptionFoundationHandlers.startPlanCheckout,
    { tier: "pro", consent: consentFor(locale) },
    buyer,
  );
  if (!lastConsentId) throw new Error("provider did not receive a consentId");
  return lastConsentId;
}

function subscriptionEvent(
  tenantId: string,
  overrides: {
    providerEventId: string;
    type?: SubscriptionEvent["type"];
    status?: SubscriptionStatus;
    consentId?: string;
    tier?: string;
  },
): SubscriptionEvent {
  return {
    providerEventId: overrides.providerEventId,
    providerName: PROVIDER,
    type: overrides.type ?? SubscriptionEventTypes.created,
    tenantId,
    providerCustomerId: "cus_confirm",
    providerSubscriptionId: "sub_confirm",
    status: overrides.status ?? SubscriptionStatuses.active,
    tier: overrides.tier ?? "pro",
    currentPeriodEnd: "2026-11-02T00:00:00Z",
    ...(overrides.consentId !== undefined && { consentId: overrides.consentId }),
  };
}

async function postWebhook(body: unknown): Promise<void> {
  const res = await stack.app.request(`/api/subscription/webhook/${PROVIDER}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "stripe-signature": "test_sig" },
  });
  expect(res.status).toBe(200);
}

async function issuedEvents(aggregateId: string, tenantId: string) {
  const events = await loadAggregate(stack.db, aggregateId, tenantId as never, {
    includeArchived: true,
  });
  return events.filter((e) => e.type === CONTRACT_CONFIRMATION_ISSUED_EVENT_QN);
}

function isIssued(data: unknown): boolean {
  return typeof data === "object" && data !== null && "issued" in data && data.issued === true;
}

function isIssueReason(data: unknown, reason: string): boolean {
  return typeof data === "object" && data !== null && "reason" in data && data.reason === reason;
}

describe("contract confirmation mail on a subscription", () => {
  test("active webhook after a recorded consent sends one German mail with plan, price, VAT note, consent texts and the full terms", async () => {
    const buyer = await createBuyer(8201);
    const consentId = await recordSubscriptionConsent(buyer, "de");

    await postWebhook(subscriptionEvent(buyer.tenantId, { providerEventId: "evt_1", consentId }));
    await stack.drainJobs();

    expect(emailTransport.sent).toHaveLength(1);
    const mail = emailTransport.sent[0];
    expect(mail?.to).toBe(BUYER_EMAIL);
    expect(mail?.subject).toBe("Vertragsbestätigung");
    const html = mail?.html ?? "";
    expect(html).toContain("Tarif: Pro plan");
    expect(html).toContain("19,00");
    expect(html).toContain("Preise inkl. USt.");
    expect(html).toContain(CONSENT_TEXTS.de.earlyPerformance);
    expect(html).toContain(CONSENT_TEXTS.de.withdrawalLoss);
    expect(html).toContain(TERMS_DE);
    expect(html).toContain("billing@example.com");

    const issued = await issuedEvents(subscriptionAggregateId(buyer.tenantId), buyer.tenantId);
    expect(issued).toHaveLength(1);
    expect(issued[0]?.payload).toMatchObject({ consentId, locale: "de", termsTemplateVersion: 1 });
  });

  test("an in-app plan switch records its consent and the plan_changed webhook carrying it sends the confirmation mail once", async () => {
    const buyer = await createBuyer(8205);
    await postWebhook(
      subscriptionEvent(buyer.tenantId, { providerEventId: "evt_1", tier: "starter" }),
    );
    await stack.drainJobs();
    expect(emailTransport.sent).toHaveLength(0);

    const result = await stack.http.writeOk(
      SubscriptionFoundationHandlers.switchPlan,
      { tier: "pro", consent: consentFor("de") },
      buyer,
    );
    expect(result).toEqual({ applied: true });
    const consentId = lastConsentId;
    if (!consentId) throw new Error("apply did not receive a consentId");

    const changed = subscriptionEvent(buyer.tenantId, {
      providerEventId: "evt_2",
      type: SubscriptionEventTypes.updated,
      consentId,
    });
    await postWebhook(changed);
    await postWebhook(changed);
    await stack.drainJobs();

    expect(emailTransport.sent).toHaveLength(1);
    const html = emailTransport.sent[0]?.html ?? "";
    expect(html).toContain("Tarif: Pro plan");
    expect(html).toContain(CONSENT_TEXTS.de.earlyPerformance);
    const issued = await issuedEvents(subscriptionAggregateId(buyer.tenantId), buyer.tenantId);
    expect(issued).toHaveLength(1);
    expect(issued[0]?.payload).toMatchObject({ consentId });
  });

  test("an English consent produces the English mail with the English terms", async () => {
    const buyer = await createBuyer(8202);
    const consentId = await recordSubscriptionConsent(buyer, "en");

    await postWebhook(subscriptionEvent(buyer.tenantId, { providerEventId: "evt_1", consentId }));
    await stack.drainJobs();

    expect(emailTransport.sent).toHaveLength(1);
    const mail = emailTransport.sent[0];
    expect(mail?.subject).toBe("Contract confirmation");
    const html = mail?.html ?? "";
    expect(html).toContain("Plan: Pro plan");
    expect(html).toContain("Prices include VAT.");
    expect(html).toContain(CONSENT_TEXTS.en.earlyPerformance);
    expect(html).toContain(TERMS_EN);
  });

  test("Markdown in the terms reaches the mail as formatting, never as literal markers", async () => {
    await asRawClient(stack.db).unsafe(
      `DELETE FROM "${templateResourcesTable.tableName}" WHERE slug = '${TERMS_SLUG}' AND locale = 'en'`,
    );
    await seedTerms(
      "en",
      [
        "## Cancellation",
        "",
        "**Right to cancel.** You have the right to cancel within *14 days*.",
        "",
        "- Write to [support](mailto:support@example.com)",
      ].join("\n"),
    );
    const buyer = await createBuyer(8204);
    const consentId = await recordSubscriptionConsent(buyer, "en");

    await postWebhook(subscriptionEvent(buyer.tenantId, { providerEventId: "evt_1", consentId }));
    await stack.drainJobs();

    expect(emailTransport.sent).toHaveLength(1);
    const html = emailTransport.sent[0]?.html ?? "";
    const text = emailTransport.sent[0]?.text ?? "";
    expect(html).toContain("<strong>Right to cancel.</strong>");
    expect(html).toContain("<em>14 days</em>");
    expect(html).toContain("<strong>Cancellation</strong>");
    expect(html).toContain('href="mailto:support@example.com"');
    expect(html).not.toContain("**");
    expect(html).not.toContain("&lt;");
    expect(text).toContain("Right to cancel.");
    expect(text).not.toContain("**");
  });

  test("a webhook replay and a later invoice-paid with the same consentId do not send a second mail", async () => {
    const buyer = await createBuyer(8203);
    const consentId = await recordSubscriptionConsent(buyer, "de");
    const created = subscriptionEvent(buyer.tenantId, { providerEventId: "evt_1", consentId });

    await postWebhook(created);
    await postWebhook(created);
    await stack.drainJobs();
    await postWebhook(
      subscriptionEvent(buyer.tenantId, {
        providerEventId: "evt_2",
        type: SubscriptionEventTypes.invoicePaid,
        consentId,
      }),
    );
    await stack.drainJobs();

    expect(emailTransport.sent).toHaveLength(1);
    expect(
      await issuedEvents(subscriptionAggregateId(buyer.tenantId), buyer.tenantId),
    ).toHaveLength(1);
  });

  test("an event without consentId or with status incomplete sends no mail", async () => {
    const buyer = await createBuyer(8204);
    const consentId = await recordSubscriptionConsent(buyer, "de");

    await postWebhook(subscriptionEvent(buyer.tenantId, { providerEventId: "evt_1" }));
    await postWebhook(
      subscriptionEvent(buyer.tenantId, {
        providerEventId: "evt_2",
        status: SubscriptionStatuses.incomplete,
        consentId,
      }),
    );
    await stack.drainJobs();

    expect(emailTransport.sent).toHaveLength(0);
    expect(
      await issuedEvents(subscriptionAggregateId(buyer.tenantId), buyer.tenantId),
    ).toHaveLength(0);
  });

  test("two concurrent issue-contract-confirmation calls issue once and mail once", async () => {
    const buyer = await createBuyer(8205);
    const consentId = await recordSubscriptionConsent(buyer, "de");
    const system = createSystemUser(buyer.tenantId);
    const payload = {
      consentId,
      sourceAggregateId: subscriptionAggregateId(buyer.tenantId),
    };

    const results = await Promise.all([
      stack.dispatcher.write(
        SubscriptionFoundationHandlers.issueContractConfirmation,
        payload,
        system,
      ),
      stack.dispatcher.write(
        SubscriptionFoundationHandlers.issueContractConfirmation,
        payload,
        system,
      ),
    ]);
    await stack.drainJobs();

    const issuedRuns = results.filter((r) => r.isSuccess && isIssued(r.data));
    expect(issuedRuns).toHaveLength(1);
    const others = results.filter((r) => !(r.isSuccess && isIssued(r.data)));
    expect(others).toHaveLength(1);
    const other = others[0];
    expect(
      other?.isSuccess === false ||
        (other?.isSuccess === true && isIssueReason(other.data, "already_issued")),
    ).toBe(true);
    expect(emailTransport.sent).toHaveLength(1);
    expect(
      await issuedEvents(subscriptionAggregateId(buyer.tenantId), buyer.tenantId),
    ).toHaveLength(1);
  });

  test("an unknown consentId is a no-op success without a mail", async () => {
    const buyer = await createBuyer(8206);
    const result = await stack.dispatcher.write(
      SubscriptionFoundationHandlers.issueContractConfirmation,
      { consentId: "does-not-exist", sourceAggregateId: subscriptionAggregateId(buyer.tenantId) },
      createSystemUser(buyer.tenantId),
    );
    expectSuccess(result);
    expect(result.data).toEqual({ issued: false, reason: "consent_not_found" });
    expect(emailTransport.sent).toHaveLength(0);
  });

  test("rejects a source aggregate that is not the caller tenant's own stream", async () => {
    const buyer = await createBuyer(8207);
    const result = await stack.dispatcher.write(
      SubscriptionFoundationHandlers.issueContractConfirmation,
      { consentId: "x", sourceAggregateId: subscriptionAggregateId(testTenantId(8299)) },
      createSystemUser(buyer.tenantId),
    );
    expectError(result);
    expect(result.error.httpStatus).toBe(422);
    expect(JSON.stringify(result.error)).toContain("invalid_source_aggregate");
  });
});

describe("contract confirmation mail time zone", () => {
  async function mailFor(buyer: ReturnType<typeof createTestUser>): Promise<string> {
    const consentId = await recordSubscriptionConsent(buyer, "en");
    await postWebhook(subscriptionEvent(buyer.tenantId, { providerEventId: "evt_tz", consentId }));
    await stack.drainJobs();
    expect(emailTransport.sent).toHaveLength(1);
    return emailTransport.sent[0]?.html ?? "";
  }

  test("the recipient's own time zone wins", async () => {
    const buyer = await createBuyer(8210, "Asia/Tokyo");
    await stack.http.writeOk(
      "config:write:set",
      { key: "tenant:config:timezone", value: "Europe/Berlin" },
      buyer,
    );
    const html = await mailFor(buyer);
    expect(html).toContain("GMT+9");
    expect(html).not.toContain("UTC");
  });

  test("without a user zone the tenant zone is used", async () => {
    const buyer = await createBuyer(8211);
    await stack.http.writeOk(
      "config:write:set",
      { key: "tenant:config:timezone", value: "Asia/Tokyo" },
      buyer,
    );
    expect(await mailFor(buyer)).toContain("GMT+9");
  });

  test("without any user or tenant setting the tenant feature's default zone applies", async () => {
    const buyer = await createBuyer(8212);
    expect(await mailFor(buyer)).toMatch(/GMT\+[12]/);
  });
});

describe("contract confirmation terms source", () => {
  test("a tenant-owned block with the terms slug does not replace the system terms", async () => {
    const buyer = await createBuyer(8213);
    await stack.http.writeOk(
      TemplateResolverHandlers.set,
      {
        slug: TERMS_SLUG,
        locale: "en",
        title: "Own terms",
        content: "Tenant-authored replacement terms",
        contentFormat: "markdown",
      },
      buyer,
    );
    const consentId = await recordSubscriptionConsent(buyer, "en");
    const events = await loadAggregate(
      stack.db,
      subscriptionAggregateId(buyer.tenantId),
      buyer.tenantId as never,
      { includeArchived: true },
    );
    const consentEvent = events.find((e) => e.type === CHECKOUT_CONSENT_RECORDED_EVENT_QN);
    expect(consentEvent?.payload).toMatchObject({
      termsHash: createHash("sha256").update(TERMS_EN).digest("hex"),
    });

    await postWebhook(subscriptionEvent(buyer.tenantId, { providerEventId: "evt_t", consentId }));
    await stack.drainJobs();
    const html = emailTransport.sent[0]?.html ?? "";
    expect(html).toContain(TERMS_EN);
    expect(html).not.toContain("Tenant-authored replacement terms");
  });
});

describe("contract confirmation mail on a one-off payment", () => {
  test("the oneOffItemLabel option labels the consent and the mail", async () => {
    const buyer = await createBuyer(8214);
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.createCheckoutSession,
      {
        providerName: PROVIDER,
        priceId: "price_topup",
        successUrl: "https://app.example.com/billing/success",
        cancelUrl: "https://app.example.com/billing/cancel",
        mode: "payment",
        consent: consentFor("en"),
      },
      buyer,
    );
    const consentId = lastConsentId;
    if (!consentId) throw new Error("provider did not receive a consentId");
    const events = await loadAggregate(
      stack.db,
      paymentAggregateId(buyer.tenantId),
      buyer.tenantId as never,
      { includeArchived: true },
    );
    expect(
      events.find((e) => e.type === CHECKOUT_CONSENT_RECORDED_EVENT_QN)?.payload,
    ).toMatchObject({
      itemLabelKey: "test-mock-confirm-provider:credits.pack.label",
      itemLabelParams: { count: 500 },
    });

    await postWebhook({
      kind: BillingEventKinds.payment,
      providerEventId: "evt_pay_item",
      providerName: PROVIDER,
      tenantId: buyer.tenantId,
      providerCustomerId: "cus_confirm",
      priceId: "price_topup",
      consentId,
    } satisfies PaymentEvent);
    await stack.drainJobs();
    expect(emailTransport.sent[0]?.html ?? "").toContain("Item: 500 credits");
  });

  test("payment-received with the consentId sends one mail", async () => {
    const buyer = await createBuyer(8208);
    await stack.http.writeOk(
      SubscriptionFoundationHandlers.createCheckoutSession,
      {
        providerName: PROVIDER,
        priceId: "price_topup",
        successUrl: "https://app.example.com/billing/success",
        cancelUrl: "https://app.example.com/billing/cancel",
        mode: "payment",
        consent: consentFor("en"),
      },
      buyer,
    );
    const consentId = lastConsentId;
    if (!consentId) throw new Error("provider did not receive a consentId");

    const payment: PaymentEvent = {
      kind: BillingEventKinds.payment,
      providerEventId: "evt_pay_1",
      providerName: PROVIDER,
      tenantId: buyer.tenantId,
      providerCustomerId: "cus_confirm",
      priceId: "price_topup",
      consentId,
    };
    await postWebhook(payment);
    await stack.drainJobs();

    expect(emailTransport.sent).toHaveLength(1);
    const html = emailTransport.sent[0]?.html ?? "";
    expect(html).toContain("Item: 500 credits");
    expect(html).toContain(TERMS_EN);
    expect(await issuedEvents(paymentAggregateId(buyer.tenantId), buyer.tenantId)).toHaveLength(1);
  });
});

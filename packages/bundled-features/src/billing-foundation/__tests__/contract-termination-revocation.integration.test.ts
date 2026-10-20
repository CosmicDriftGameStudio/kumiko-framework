// § 312k "this cancellation was not me": the signed link in the receipt mail of
// a matched public declaration, through real HTTP (the public pages and
// /api/write), with the provider mocked and mails read from the in-memory
// transport after the job cascade drained.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import {
  createSystemUser,
  defineFeature,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import { expectSuccess, seedRow } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
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
import { subscriptionAggregateId } from "../aggregate-id.ts";
import {
  SubscriptionEventTypes,
  SubscriptionFoundationHandlers,
  SubscriptionStatuses,
} from "../constants.ts";
import { createContractTerminationRoutes } from "../consumer-protection/termination-pages.ts";
import { REVOCATION_PATHS } from "../consumer-protection/termination-revoke.ts";
import {
  CONTRACT_TERMINATION_DECLARED_EVENT_QN,
  CONTRACT_TERMINATION_REQUESTED_EVENT_QN,
  CONTRACT_TERMINATION_REVOKED_EVENT_QN,
} from "../events.ts";
import { createBillingFoundationFeature } from "../feature.ts";
import type {
  BillingPlanCatalog,
  ConsumerProtectionOptions,
  SubscriptionEvent,
  SubscriptionProviderPlugin,
} from "../types.ts";
import { createSubscriptionWebhookRoute } from "../webhook-handler.ts";

const PROVIDER = "mock-revocation-provider";
const PROVIDER_WITHOUT_RESUME = "mock-revocation-provider-no-resume";
const TERMS_SLUG = "billing-terms";
const ANONYMOUS_TENANT = testTenantId(8300);
const OPERATOR_EMAIL = "billing@example.com";
const BASE_URL = "https://app.example.com";

const consumerProtection: ConsumerProtectionOptions = {
  termsTextBlock: TERMS_SLUG,
  vatNote: { de: "Preise inkl. USt.", en: "Prices include VAT." },
  operatorEmail: OPERATOR_EMAIL,
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
const cancelCalls: string[] = [];
const resumeCalls: string[] = [];
let resumeFails = false;
let clockOffsetDays = 0;
type ProviderCancelHold = {
  readonly released: Promise<void>;
  readonly entered: () => void;
};
let providerCancelHold: ProviderCancelHold | undefined;

function mockPlugin(withResume: boolean): SubscriptionProviderPlugin {
  return {
    verifyAndParseWebhook: async (rawBody) => JSON.parse(rawBody) as SubscriptionEvent | null,
    priceToTier: { price_starter: "starter", price_pro: "pro" },
    cancelSubscription: async (_ctx, options) => {
      if (providerCancelHold) {
        providerCancelHold.entered();
        await providerCancelHold.released;
      }
      cancelCalls.push(options.providerSubscriptionId);
    },
    ...(withResume && {
      resumeSubscription: async (_ctx, options) => {
        if (resumeFails) throw new Error("provider down");
        resumeCalls.push(options.providerSubscriptionId);
      },
    }),
  };
}

const mockProviderFeature = defineFeature("test-mock-revocation-provider", (r) => {
  r.requires({ features: ["billing-foundation"] });
  r.useExtension("subscriptionProvider", PROVIDER, mockPlugin(true));
  r.useExtension("subscriptionProvider", PROVIDER_WITHOUT_RESUME, mockPlugin(false));
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
        baseUrl: BASE_URL,
        catalog,
        now: () => Temporal.Now.instant().add({ hours: clockOffsetDays * 24 }),
        consumerProtection,
      }),
      mockProviderFeature,
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      templateResolver: createTemplateResolverApi(deps.db),
    }),
    extraRoutes: [createSubscriptionWebhookRoute(), ...createContractTerminationRoutes()],
    anonymousAccess: { defaultTenantId: ANONYMOUS_TENANT },
    jobs: { consumerLane: "worker", queueNamePrefix: `contract-revocation-${generateId()}` },
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

beforeEach(async () => {
  await stack.drainJobs();
  emailTransport.sent.length = 0;
  cancelCalls.length = 0;
  resumeCalls.length = 0;
  resumeFails = false;
  clockOffsetDays = 0;
  providerCancelHold = undefined;
});

function nextClientIp(): string {
  ipCounter += 1;
  return `10.9.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

async function seedMatchedAdmin(
  email: string,
  tenantNumber: number,
  providerName: string = PROVIDER,
): Promise<void> {
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    { email, passwordHash: "not-a-real-hash", displayName: "Declarant" },
    TestUsers.systemAdmin,
  );
  expectSuccess(
    await stack.dispatcher.write(
      TenantHandlers.addMember,
      { userId: created.id, tenantId: testTenantId(tenantNumber), roles: ["TenantAdmin"] },
      createSystemUser(TestUsers.systemAdmin.tenantId, ["SystemAdmin"]),
    ),
  );
  const event: SubscriptionEvent = {
    providerEventId: `evt_sub_${tenantNumber}`,
    providerName,
    type: SubscriptionEventTypes.created,
    tenantId: testTenantId(tenantNumber),
    providerCustomerId: `cus_${tenantNumber}`,
    providerSubscriptionId: `sub_${tenantNumber}`,
    status: SubscriptionStatuses.active,
    tier: "pro",
    currentPeriodEnd: "2026-11-02T00:00:00Z",
  };
  const res = await stack.app.request(`/api/subscription/webhook/${providerName}`, {
    method: "POST",
    body: JSON.stringify(event),
    headers: { "stripe-signature": "test_sig" },
  });
  expect(res.status).toBe(200);
}

async function postDeclaration(email: string): Promise<Response> {
  return stack.app.request(
    "/api/write",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
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
    },
    nextClientIp(),
  );
}

async function declare(email: string): Promise<{ requestId: string }> {
  const res = await postDeclaration(email);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { requestId: string } };
  await stack.drainJobs();
  return body.data;
}

function mailsTo(address: string) {
  return emailTransport.sent.filter((mail) => mail.to === address);
}

function revokeLinkOf(email: string): URL {
  const html = mailsTo(email)[0]?.html ?? "";
  const href = /href="([^"]*zuruecknehmen[^"]*)"/.exec(html)?.[1];
  expect(href).toBeDefined();
  // The mail HTML entity-encodes the query separators; a mail client decodes them.
  return new URL((href ?? "").replaceAll("&amp;", "&").replaceAll("&#x3D;", "="));
}

function revokeForm(link: URL, overrides: Record<string, string> = {}): string {
  return new URLSearchParams({
    r: link.searchParams.get("r") ?? "",
    t: link.searchParams.get("t") ?? "",
    tenant: link.searchParams.get("tenant") ?? "",
    ...overrides,
  }).toString();
}

async function postRevocation(body: string): Promise<Response> {
  return stack.app.request(
    REVOCATION_PATHS.de,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    },
    nextClientIp(),
  );
}

async function streamEvents(tenantNumber: number, type: string) {
  const events = await loadAggregate(
    stack.db,
    subscriptionAggregateId(testTenantId(tenantNumber)),
    testTenantId(tenantNumber),
    { includeArchived: true },
  );
  return events.filter((e) => e.type === type);
}

describe("receipt mail link", () => {
  test("a matched declaration gets a link to the fixed revoke path on the base origin, an unmatched one gets none", async () => {
    await seedMatchedAdmin("matched@example.com", 8301);

    const matched = await declare("matched@example.com");
    await declare("nobody@example.com");

    const link = revokeLinkOf("matched@example.com");
    expect(link.origin).toBe(BASE_URL);
    expect(link.pathname).toBe(REVOCATION_PATHS.de);
    expect(link.searchParams.get("r")).toBe(matched.requestId);
    expect(link.searchParams.get("tenant")).toBe(testTenantId(8301));
    expect(mailsTo("matched@example.com")[0]?.html).toContain("Diese Kündigung war ich nicht");
    const unmatchedHtml = mailsTo("nobody@example.com")[0]?.html ?? "";
    expect(unmatchedHtml).not.toContain("zuruecknehmen");
    expect(unmatchedHtml).not.toContain("Diese Kündigung war ich nicht");
    const declared = await streamEvents(8301, CONTRACT_TERMINATION_DECLARED_EVENT_QN);
    const declaredPayload = declared[0]?.payload as { revocationTokenHash?: string } | undefined;
    const storedHash = declaredPayload?.revocationTokenHash;
    expect(storedHash).toHaveLength(64);
    expect(JSON.stringify(declared[0]?.payload)).not.toContain(link.searchParams.get("t") ?? "x");
  });
});

describe("revoke pages", () => {
  test("GET shows the confirmation form and changes nothing", async () => {
    await seedMatchedAdmin("get@example.com", 8302);
    await declare("get@example.com");
    const link = revokeLinkOf("get@example.com");

    const res = await stack.app.request(`${link.pathname}${link.search}`, {}, nextClientIp());

    expect(res.status).toBe(200);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    const html = await res.text();
    expect(html).toContain('type="hidden" name="t"');
    expect(html).toContain("Kündigung zurücknehmen?");
    expect(await streamEvents(8302, CONTRACT_TERMINATION_REVOKED_EVENT_QN)).toHaveLength(0);
    expect(resumeCalls).toEqual([]);
  });

  test("POST resumes at the provider, records the revocation and tells the operator; a second POST is idempotent", async () => {
    await seedMatchedAdmin("revoke@example.com", 8303);
    const { requestId } = await declare("revoke@example.com");
    expect(cancelCalls).toEqual(["sub_8303"]);
    const link = revokeLinkOf("revoke@example.com");
    emailTransport.sent.length = 0;

    const first = await postRevocation(revokeForm(link));
    await stack.drainJobs();

    expect(first.status).toBe(200);
    expect(await first.text()).toContain("Die Kündigung ist zurückgenommen");
    expect(resumeCalls).toEqual(["sub_8303"]);
    const revoked = await streamEvents(8303, CONTRACT_TERMINATION_REVOKED_EVENT_QN);
    expect(revoked.map((e) => (e.payload as { requestId: string }).requestId)).toEqual([requestId]);
    const notices = mailsTo(OPERATOR_EMAIL);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.html).toContain("Postfachinhaber");

    const second = await postRevocation(revokeForm(link));
    await stack.drainJobs();

    expect(second.status).toBe(200);
    expect(await second.text()).toContain("Schon zurückgenommen");
    expect(resumeCalls).toEqual(["sub_8303"]);
    expect(await streamEvents(8303, CONTRACT_TERMINATION_REVOKED_EVENT_QN)).toHaveLength(1);
    expect(mailsTo(OPERATOR_EMAIL)).toHaveLength(1);
  });

  test("a wrong token, an unknown request and a foreign tenant get the same generic answer and revoke nothing", async () => {
    await seedMatchedAdmin("tamper@example.com", 8304);
    await declare("tamper@example.com");
    const link = revokeLinkOf("tamper@example.com");

    const wrongToken = await postRevocation(
      revokeForm(link, { t: `${link.searchParams.get("t")}x` }),
    );
    const unknownRequest = await postRevocation(revokeForm(link, { r: generateId() }));
    const foreignTenant = await postRevocation(revokeForm(link, { tenant: testTenantId(8399) }));
    const missingParams = await postRevocation("");

    for (const res of [wrongToken, unknownRequest, foreignTenant, missingParams]) {
      expect(res.status).toBe(400);
    }
    const wrongTokenHtml = await wrongToken.text();
    expect(wrongTokenHtml).toContain("Link ungültig");
    expect(await unknownRequest.text()).toBe(wrongTokenHtml);
    expect(await foreignTenant.text()).toBe(wrongTokenHtml);
    expect(await missingParams.text()).toBe(wrongTokenHtml);
    expect(await streamEvents(8304, CONTRACT_TERMINATION_REVOKED_EVENT_QN)).toHaveLength(0);
    expect(resumeCalls).toEqual([]);
  });

  test("a declaration written without a token hash cannot be revoked", async () => {
    await seedMatchedAdmin("legacy@example.com", 8305);
    const requestId = generateId();
    expectSuccess(
      await stack.dispatcher.write(
        SubscriptionFoundationHandlers.declareContractTermination,
        {
          requestId,
          declarationType: "termination",
          terminationKind: "ordinary",
          receivedAtIso: Temporal.Now.instant().toString(),
          locale: "de",
        },
        createSystemUser(testTenantId(8305)),
      ),
    );
    await stack.drainJobs();

    const res = await postRevocation(
      new URLSearchParams({ r: requestId, t: "anything", tenant: testTenantId(8305) }).toString(),
    );

    expect(res.status).toBe(400);
    expect(await streamEvents(8305, CONTRACT_TERMINATION_REVOKED_EVENT_QN)).toHaveLength(0);
  });

  test("after the cancellation took effect the answer is too late and nothing is resumed", async () => {
    await seedMatchedAdmin("late@example.com", 8306);
    await declare("late@example.com");
    const link = revokeLinkOf("late@example.com");
    clockOffsetDays = 400;

    const res = await postRevocation(revokeForm(link));

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Zu spät für die Rücknahme");
    expect(resumeCalls).toEqual([]);
    expect(await streamEvents(8306, CONTRACT_TERMINATION_REVOKED_EVENT_QN)).toHaveLength(0);
  });

  test("a revocation while the provider cancel is in flight prevents the record and resumes afterwards", async () => {
    await seedMatchedAdmin("inflight@example.com", 8307);
    const release = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    providerCancelHold = { released: release.promise, entered: () => entered.resolve() };

    const declared = await postDeclaration("inflight@example.com");
    expect(declared.status).toBe(200);
    const draining = stack.drainJobs();
    await entered.promise;
    const link = revokeLinkOf("inflight@example.com");

    const res = await postRevocation(revokeForm(link));
    release.resolve();
    await draining;
    await stack.drainJobs();

    expect(await res.text()).toContain("Die Kündigung ist zurückgenommen");
    expect(cancelCalls).toEqual(["sub_8307"]);
    expect(resumeCalls).toEqual(["sub_8307"]);
    expect(await streamEvents(8307, CONTRACT_TERMINATION_REQUESTED_EVENT_QN)).toHaveLength(0);
    expect(await streamEvents(8307, CONTRACT_TERMINATION_REVOKED_EVENT_QN)).toHaveLength(1);
  });

  test("a provider without resumeSubscription asks the operator to undo the cancellation by hand", async () => {
    await seedMatchedAdmin("noresume@example.com", 8308, PROVIDER_WITHOUT_RESUME);
    await declare("noresume@example.com");
    const link = revokeLinkOf("noresume@example.com");
    emailTransport.sent.length = 0;

    const res = await postRevocation(revokeForm(link));
    await stack.drainJobs();

    expect(res.status).toBe(200);
    expect(await streamEvents(8308, CONTRACT_TERMINATION_REVOKED_EVENT_QN)).toHaveLength(1);
    expect(resumeCalls).toEqual([]);
    expect(mailsTo(OPERATOR_EMAIL)[0]?.html).toContain("manuell zurücknehmen");
  });

  test("a failing resume still records the revocation and tells the operator", async () => {
    await seedMatchedAdmin("resumefail@example.com", 8309);
    await declare("resumefail@example.com");
    const link = revokeLinkOf("resumefail@example.com");
    emailTransport.sent.length = 0;
    resumeFails = true;

    const res = await postRevocation(revokeForm(link));
    await stack.drainJobs();

    expect(res.status).toBe(200);
    expect(await streamEvents(8309, CONTRACT_TERMINATION_REVOKED_EVENT_QN)).toHaveLength(1);
    expect(mailsTo(OPERATOR_EMAIL)[0]?.html).toContain("konnte nicht zurückgenommen werden");
  });
});

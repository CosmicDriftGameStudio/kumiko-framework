// § 312k contract termination: anonymous declarations through real
// HTTP (/api/write and the public pages), the account path through
// /api/write with a session, provider cancel recorded by a mock plugin, mails
// captured by the in-memory email transport after the job cascade drained.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineFeature, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { seedRow } from "@cosmicdrift/kumiko-framework/testing";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
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
import { userEntity, userTable } from "../../user/schema/user.js";
import { subscriptionAggregateId, terminationUnmatchedAggregateId } from "../aggregate-id.js";
import {
  SubscriptionEventTypes,
  SubscriptionFoundationHandlers,
  SubscriptionStatuses,
} from "../constants.js";
import { formatReceivedAt } from "../consumer-protection/termination-mail.js";
import { createContractTerminationRoutes } from "../consumer-protection/termination-pages.js";
import {
  CONTRACT_TERMINATION_REQUESTED_EVENT_QN,
  CONTRACT_TERMINATION_UNMATCHED_EVENT_QN,
} from "../events.js";
import { createBillingFoundationFeature } from "../feature.js";
import type {
  BillingPlanCatalog,
  ConsumerProtectionOptions,
  SubscriptionEvent,
  SubscriptionProviderPlugin,
} from "../types.js";
import { createSubscriptionWebhookRoute } from "../webhook-handler.js";

const PROVIDER = "mock-termination-provider";
const TERMS_SLUG = "billing-terms";
const ANONYMOUS_TENANT = testTenantId(8100);
const OPERATOR_EMAIL = "billing@example.com";
const DECLARANT_NAME = "Zebra Quirkmann";
const DECLARANT_REASON = "reason-needle-4711";
const WRITE_REQUEST_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

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
type CancelCall = { readonly providerSubscriptionId: string; readonly when: string };
const cancelCalls: CancelCall[] = [];
let providerCancelFails = false;

const mockProviderFeature = defineFeature("test-mock-termination-provider", (r) => {
  r.requires("billing-foundation");
  const plugin: SubscriptionProviderPlugin = {
    verifyAndParseWebhook: async (rawBody) => JSON.parse(rawBody) as SubscriptionEvent | null,
    priceToTier: { price_starter: "starter", price_pro: "pro" },
    cancelSubscription: async (_ctx, options) => {
      if (providerCancelFails) throw new Error("provider down");
      cancelCalls.push({
        providerSubscriptionId: options.providerSubscriptionId,
        when: options.when,
      });
    },
  };
  r.useExtension("subscriptionProvider", PROVIDER, plugin);
});

let stack: TestStack;
let ipCounter = 0;

type StackAnonymousAccess = NonNullable<Parameters<typeof setupTestStack>[0]["anonymousAccess"]>;

async function createTerminationStack(anonymousAccess: StackAnonymousAccess): Promise<TestStack> {
  const terminationStack = await setupTestStack({
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
    extraRoutes: [createSubscriptionWebhookRoute(), ...createContractTerminationRoutes()],
    anonymousAccess,
    jobs: { consumerLane: "worker", queueNamePrefix: `contract-termination-${generateId()}` },
  });
  await unsafeCreateEntityTable(terminationStack.db, userEntity);
  await unsafeCreateEntityTable(terminationStack.db, tenantEntity);
  await unsafeCreateEntityTable(terminationStack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(terminationStack.db, templateResourceEntity);
  await unsafeCreateEntityTable(terminationStack.db, notificationPreferenceEntity);
  return terminationStack;
}

beforeAll(async () => {
  stack = await createTerminationStack({ defaultTenantId: ANONYMOUS_TENANT });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  emailTransport.sent.length = 0;
  cancelCalls.length = 0;
  providerCancelFails = false;
  await stack.db.unsafe?.(`TRUNCATE kumiko_events, read_subscriptions, read_payments CASCADE`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${templateResourcesTable.tableName}"`);
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

// A distinct client IP per test keeps the handler's per-IP bucket from
// leaking between tests; the bucket itself is never raised.
function nextClientIp(): string {
  ipCounter += 1;
  return `10.8.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

async function createUser(email: string): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    { email, passwordHash: "not-a-real-hash", displayName: "Declarant" },
    TestUsers.systemAdmin,
  );
  return created.id;
}

async function addMember(userId: string, tenantNumber: number, roles: string[]): Promise<void> {
  await stack.http.writeOk(
    TenantHandlers.addMember,
    { userId, tenantId: testTenantId(tenantNumber), roles },
    TestUsers.systemAdmin,
  );
}

async function seedSubscription(tenantNumber: number, providerSubscriptionId: string) {
  const event: SubscriptionEvent = {
    providerEventId: `evt_${providerSubscriptionId}`,
    providerName: PROVIDER,
    type: SubscriptionEventTypes.created,
    tenantId: testTenantId(tenantNumber),
    providerCustomerId: `cus_${providerSubscriptionId}`,
    providerSubscriptionId,
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

type DeclarationInput = {
  readonly email: string;
  readonly declarationType?: "termination" | "withdrawal";
  readonly terminationKind?: "ordinary" | "extraordinary";
  readonly reason?: string;
};

function declarationPayload(input: DeclarationInput) {
  return {
    declarationType: input.declarationType ?? "termination",
    terminationKind: input.terminationKind ?? "ordinary",
    name: DECLARANT_NAME,
    email: input.email,
    locale: "de",
    ...(input.reason !== undefined && { reason: input.reason }),
  };
}

async function postDeclaration(input: DeclarationInput, clientIp: string): Promise<Response> {
  return stack.app.request(
    "/api/write",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: SubscriptionFoundationHandlers.requestContractTermination,
        payload: declarationPayload(input),
      }),
    },
    clientIp,
  );
}

type DeclarationReceipt = { readonly requestId: string; readonly receivedAtIso: string };

async function declare(input: DeclarationInput): Promise<DeclarationReceipt> {
  const res = await postDeclaration(input, nextClientIp());
  expect(res.status).toBe(200);
  const body = (await res.json()) as { isSuccess: boolean; data: DeclarationReceipt };
  expect(body.isSuccess).toBe(true);
  await stack.drainJobs();
  return body.data;
}

async function eventsOf(aggregateId: string, tenantId: string, type: string) {
  const events = await loadAggregate(stack.db, aggregateId, tenantId as never, {
    includeArchived: true,
  });
  return events.filter((e) => e.type === type);
}

function mailsTo(address: string) {
  return emailTransport.sent.filter((mail) => mail.to === address);
}

// Strips what legitimately differs per request so receipts of different
// branches can be compared byte for byte.
function normalizedReceipt(html: string, receipt: DeclarationReceipt, email: string): string {
  return html
    .replaceAll(receipt.requestId, "<REQUEST_ID>")
    .replaceAll(formatReceivedAt(receipt.receivedAtIso, "de"), "<RECEIVED_AT>")
    .replaceAll(email, "<EMAIL>");
}

describe("public pages", () => {
  test.each([
    ["/legal/kuendigen", "Vertrag kündigen oder widerrufen", "Jetzt kündigen"],
    ["/legal/cancel", "Terminate or withdraw from your contract", "Cancel now"],
  ])("GET %s without a token serves the form with framing denied", async (path, title) => {
    const res = await stack.app.request(path, {}, nextClientIp());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const html = await res.text();
    expect(html).toContain(title);
    expect(html).toContain('name="email"');
    expect(html).toContain('name="declarationType"');
  });

  async function postForm(path: string, fields: Record<string, string>, clientIp: string) {
    return stack.app.request(
      path,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
      },
      clientIp,
    );
  }

  const hostileFields = {
    declarationType: "termination",
    terminationKind: "extraordinary",
    name: "<script>alert(1)</script>",
    email: "page@example.com",
    customerReference: '"><img src=x onerror=alert(2)>',
    reason: "<script>alert(3)</script> because",
  };

  test("review step echoes the values escaped and offers the confirm button", async () => {
    const res = await postForm(
      "/legal/cancel",
      { ...hostileFields, step: "review" },
      nextClientIp(),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Cancel now");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
  });

  test("invalid input returns the form again with messages and no declaration", async () => {
    const res = await postForm(
      "/legal/kuendigen",
      { ...hostileFields, reason: "", email: "not-an-email", step: "review" },
      nextClientIp(),
    );
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("Bitte gib eine gültige E-Mail-Adresse an.");
    expect(html).toContain("außerordentlichen Kündigung ist eine Begründung nötig");
    expect(html).not.toContain("<script>alert");
  });

  test("confirm step submits the declaration and shows time of receipt and request id", async () => {
    const ip = nextClientIp();
    const res = await postForm("/legal/kuendigen", { ...hostileFields, step: "confirm" }, ip);
    expect(res.status).toBe(200);
    const html = await res.text();
    const requestId = WRITE_REQUEST_ID_PATTERN.exec(html)?.[0];
    expect(requestId).toBeDefined();
    expect(html).toContain("Deine Erklärung ist eingegangen");
    expect(html).toMatch(/Eingegangen am: <strong>[^<]+\d{2}:\d{2}:\d{2}/);
    await stack.drainJobs();
    expect(mailsTo("page@example.com")).toHaveLength(1);
    const mailHtml = mailsTo("page@example.com")[0]?.html ?? "";
    expect(mailHtml).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(mailHtml).not.toContain("<script>alert");
  });

  test("the sixth confirm from one IP gets a friendly 429 page", async () => {
    const ip = nextClientIp();
    for (let i = 0; i < 5; i += 1) {
      const ok = await postForm("/legal/cancel", { ...hostileFields, step: "confirm" }, ip);
      expect(ok.status).toBe(200);
    }
    const limited = await postForm("/legal/cancel", { ...hostileFields, step: "confirm" }, ip);
    expect(limited.status).toBe(429);
    expect(await limited.text()).toContain("Too many requests");
  });
});

describe("public declaration through /api/write", () => {
  test("a matched TenantAdmin email cancels at period end and gets the receipt", async () => {
    const email = "matched@example.com";
    const userId = await createUser(email);
    await addMember(userId, 8101, ["TenantAdmin"]);
    await seedSubscription(8101, "sub_matched");

    const receipt = await declare({ email });

    expect(cancelCalls).toEqual([{ providerSubscriptionId: "sub_matched", when: "period-end" }]);
    const events = await eventsOf(
      subscriptionAggregateId(testTenantId(8101)),
      testTenantId(8101),
      CONTRACT_TERMINATION_REQUESTED_EVENT_QN,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      requestId: receipt.requestId,
      declarationType: "termination",
      terminationKind: "ordinary",
      channel: "public",
      receivedAtIso: expect.any(String),
      effectiveAtIso: expect.stringContaining("2026-11-02"),
      providerCancel: "period-end",
    });
    const mails = mailsTo(email);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.html).toContain(DECLARANT_NAME);
    expect(mails[0]?.html).toContain(receipt.requestId);
    expect(mailsTo(OPERATOR_EMAIL)).toHaveLength(0);
  });

  test("unknown and ambiguous emails answer and mail the receipt exactly like a match", async () => {
    const matchedEmail = "matched-twin@example.com";
    const matchedUser = await createUser(matchedEmail);
    await addMember(matchedUser, 8102, ["TenantAdmin"]);
    await seedSubscription(8102, "sub_twin");
    const ambiguousEmail = "ambiguous@example.com";
    const ambiguousUser = await createUser(ambiguousEmail);
    await addMember(ambiguousUser, 8103, ["TenantAdmin"]);
    await addMember(ambiguousUser, 8104, ["TenantAdmin"]);
    await seedSubscription(8103, "sub_amb_a");
    await seedSubscription(8104, "sub_amb_b");
    const unknownEmail = "nobody@example.com";

    const matched = await declare({ email: matchedEmail });
    const unknown = await declare({ email: unknownEmail });
    const ambiguous = await declare({ email: ambiguousEmail });

    expect(Object.keys(unknown).sort()).toEqual(Object.keys(matched).sort());
    expect(Object.keys(ambiguous).sort()).toEqual(Object.keys(matched).sort());

    const matchedMail = mailsTo(matchedEmail)[0];
    const unknownMail = mailsTo(unknownEmail)[0];
    const ambiguousMail = mailsTo(ambiguousEmail)[0];
    expect(matchedMail && unknownMail && ambiguousMail).toBeTruthy();
    const expected = normalizedReceipt(matchedMail?.html ?? "", matched, matchedEmail);
    expect(normalizedReceipt(unknownMail?.html ?? "", unknown, unknownEmail)).toBe(expected);
    expect(normalizedReceipt(ambiguousMail?.html ?? "", ambiguous, ambiguousEmail)).toBe(expected);
    expect(unknownMail?.subject).toBe(matchedMail?.subject);
    expect(ambiguousMail?.subject).toBe(matchedMail?.subject);

    const unknownEvents = await eventsOf(
      terminationUnmatchedAggregateId(unknown.requestId),
      SYSTEM_TENANT_ID,
      CONTRACT_TERMINATION_UNMATCHED_EVENT_QN,
    );
    expect(unknownEvents.map((e) => e.payload)).toEqual([
      {
        requestId: unknown.requestId,
        declarationType: "termination",
        terminationKind: "ordinary",
        channel: "public",
        receivedAtIso: unknown.receivedAtIso,
        matchResult: "none",
      },
    ]);
    const ambiguousEvents = await eventsOf(
      terminationUnmatchedAggregateId(ambiguous.requestId),
      SYSTEM_TENANT_ID,
      CONTRACT_TERMINATION_UNMATCHED_EVENT_QN,
    );
    expect(ambiguousEvents[0]?.payload).toMatchObject({ matchResult: "ambiguous" });

    expect(cancelCalls).toEqual([{ providerSubscriptionId: "sub_twin", when: "period-end" }]);
    const operatorMails = mailsTo(OPERATOR_EMAIL);
    expect(operatorMails).toHaveLength(2);
    expect(operatorMails.map((m) => m.html).join("\n")).toContain(unknown.requestId);
    expect(operatorMails.map((m) => m.html).join("\n")).toContain(DECLARANT_NAME);
  });

  test("a public withdrawal records and notifies the operator but never calls the provider", async () => {
    const email = "withdrawer@example.com";
    const userId = await createUser(email);
    await addMember(userId, 8105, ["TenantAdmin"]);
    await seedSubscription(8105, "sub_withdraw");

    const receipt = await declare({ email, declarationType: "withdrawal" });

    expect(cancelCalls).toEqual([]);
    const events = await eventsOf(
      subscriptionAggregateId(testTenantId(8105)),
      testTenantId(8105),
      CONTRACT_TERMINATION_REQUESTED_EVENT_QN,
    );
    expect(events[0]?.payload).toMatchObject({
      requestId: receipt.requestId,
      declarationType: "withdrawal",
      providerCancel: "none",
      effectiveAtIso: null,
    });
    expect(mailsTo(email)).toHaveLength(1);
    const operatorMails = mailsTo(OPERATOR_EMAIL);
    expect(operatorMails).toHaveLength(1);
    expect(operatorMails[0]?.html).toContain(DECLARANT_NAME);
    expect(operatorMails[0]?.html).toContain(email);
  });

  test("a provider error still records the declaration with providerCancel none and notifies the operator", async () => {
    const email = "provider-error@example.com";
    const userId = await createUser(email);
    await addMember(userId, 8106, ["TenantAdmin"]);
    await seedSubscription(8106, "sub_error");
    providerCancelFails = true;

    await declare({ email });

    const events = await eventsOf(
      subscriptionAggregateId(testTenantId(8106)),
      testTenantId(8106),
      CONTRACT_TERMINATION_REQUESTED_EVENT_QN,
    );
    expect(events[0]?.payload).toMatchObject({ providerCancel: "none", effectiveAtIso: null });
    expect(mailsTo(email)).toHaveLength(1);
    expect(mailsTo(OPERATOR_EMAIL)).toHaveLength(1);
  });

  test("a non-admin member email is treated as unmatched", async () => {
    const email = "plain-member@example.com";
    const userId = await createUser(email);
    await addMember(userId, 8107, ["User"]);
    await seedSubscription(8107, "sub_member");

    await declare({ email });

    expect(cancelCalls).toEqual([]);
    expect(mailsTo(OPERATOR_EMAIL)).toHaveLength(1);
  });

  test("no event payload carries the name, email or reason", async () => {
    const email = "pii-check@example.com";
    const userId = await createUser(email);
    await addMember(userId, 8108, ["TenantAdmin"]);
    await seedSubscription(8108, "sub_pii");
    await declare({ email, terminationKind: "extraordinary", reason: DECLARANT_REASON });
    await declare({
      email: "pii-unknown@example.com",
      terminationKind: "extraordinary",
      reason: DECLARANT_REASON,
    });

    const rows = (await asRawClient(stack.db).unsafe(
      `SELECT type, row_to_json(e)::text AS raw FROM kumiko_events e`,
    )) as { type: string; raw: string }[];
    expect(rows.length).toBeGreaterThan(0);
    const everything = rows.map((row) => row.raw).join("\n");
    expect(everything).toContain("contract-termination-requested");
    expect(everything).toContain("contract-termination-unmatched");
    // Name and reason appear in no stored event at all.
    expect(everything).not.toContain(DECLARANT_NAME);
    expect(everything).not.toContain(DECLARANT_REASON);
    // The email is legitimate in the seeded user and in the delivery
    // attempt audit rows (delivery's own recipient record); never elsewhere.
    const rest = rows
      .filter((row) => row.type !== "user.created" && row.type !== "delivery:event:attempt")
      .map((row) => row.raw)
      .join("\n");
    expect(rest).not.toContain("pii-check@");
    expect(rest).not.toContain("pii-unknown@");
  });

  test("the sixth request from one IP within the window is rejected", async () => {
    const ip = nextClientIp();
    for (let i = 0; i < 5; i += 1) {
      expect((await postDeclaration({ email: "limit@example.com" }, ip)).status).toBe(200);
    }
    const sixth = await postDeclaration({ email: "limit@example.com" }, ip);
    expect(sixth.status).toBe(429);
    expect(((await sixth.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
    expect((await postDeclaration({ email: "limit@example.com" }, nextClientIp())).status).toBe(
      200,
    );
  });

  test("an authenticated caller cannot use the anonymous handler", async () => {
    const userId = await createUser("auth-caller@example.com");
    const caller = createTestUser({
      id: userId,
      tenantId: testTenantId(8109),
      roles: ["TenantAdmin"],
    });
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.requestContractTermination,
      declarationPayload({ email: "auth-caller@example.com" }),
      caller,
    );
    expect(error.httpStatus).toBe(403);
  });
});

describe("terminate-contract (account path)", () => {
  async function adminOf(tenantNumber: number, email: string, roles: string[]) {
    const userId = await createUser(email);
    return createTestUser({ id: userId, tenantId: testTenantId(tenantNumber), roles });
  }

  test("a TenantAdmin termination cancels at period end and mails the caller", async () => {
    const admin = await adminOf(8110, "admin-term@example.com", ["TenantAdmin"]);
    await seedSubscription(8110, "sub_account_term");

    const result = await stack.http.writeOk<{
      requestId: string;
      receivedAtIso: string;
      effectiveAtIso: string | null;
      providerCancel: string;
    }>(
      SubscriptionFoundationHandlers.terminateContract,
      { declarationType: "termination", terminationKind: "ordinary" },
      admin,
    );
    await stack.drainJobs();

    expect(result.providerCancel).toBe("period-end");
    expect(result.effectiveAtIso).toContain("2026-11-02");
    expect(cancelCalls).toEqual([
      { providerSubscriptionId: "sub_account_term", when: "period-end" },
    ]);
    expect(mailsTo("admin-term@example.com")).toHaveLength(1);
    expect(mailsTo(OPERATOR_EMAIL)).toHaveLength(0);
    const events = await eventsOf(
      subscriptionAggregateId(testTenantId(8110)),
      testTenantId(8110),
      CONTRACT_TERMINATION_REQUESTED_EVENT_QN,
    );
    expect(events[0]?.payload).toMatchObject({ channel: "account", providerCancel: "period-end" });
  });

  test("a withdrawal cancels immediately and notifies the operator", async () => {
    const admin = await adminOf(8111, "admin-withdraw@example.com", ["TenantAdmin"]);
    await seedSubscription(8111, "sub_account_withdraw");

    const result = await stack.http.writeOk<{ providerCancel: string; effectiveAtIso: string }>(
      SubscriptionFoundationHandlers.terminateContract,
      { declarationType: "withdrawal", terminationKind: "ordinary" },
      admin,
    );
    await stack.drainJobs();

    expect(result.providerCancel).toBe("immediately");
    expect(cancelCalls).toEqual([
      { providerSubscriptionId: "sub_account_withdraw", when: "immediately" },
    ]);
    expect(mailsTo("admin-withdraw@example.com")).toHaveLength(1);
    expect(mailsTo(OPERATOR_EMAIL)).toHaveLength(1);
  });

  test("a user without a purchase role is denied and nothing is cancelled", async () => {
    const member = await adminOf(8112, "plain@example.com", ["User"]);
    await seedSubscription(8112, "sub_denied");

    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.terminateContract,
      { declarationType: "termination", terminationKind: "ordinary" },
      member,
    );

    expect(error.httpStatus).toBe(403);
    expect(cancelCalls).toEqual([]);
  });
});

describe("public pages on a host that resolves no tenant", () => {
  let noTenantStack: TestStack;

  beforeAll(async () => {
    noTenantStack = await createTerminationStack({
      tenantResolver: () => null,
      resolverTrust: "authoritative",
      tenantExists: async (id) => id === ANONYMOUS_TENANT,
    });
  });

  afterAll(async () => {
    await noTenantStack.cleanup();
  });

  // An authoritative resolver's silence is final: the anonymous dispatcher
  // answers tenant_required before the handler runs, so the routes must be
  // mounted on a host that resolves a tenant.
  test("the confirm step cannot record a declaration and shows the generic error", async () => {
    const res = await noTenantStack.app.request(
      "/legal/kuendigen",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          declarationType: "termination",
          terminationKind: "ordinary",
          name: DECLARANT_NAME,
          email: "no-tenant-host@example.com",
          step: "confirm",
        }).toString(),
      },
      nextClientIp(),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("Deine Erklärung ist eingegangen");
    const direct = await noTenantStack.app.request(
      "/api/write",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: SubscriptionFoundationHandlers.requestContractTermination,
          payload: declarationPayload({ email: "no-tenant-host@example.com" }),
        }),
      },
      nextClientIp(),
    );
    expect(direct.status).toBe(400);
    const body = (await direct.json()) as { error: { code: string } };
    expect(body.error.code).toBe("tenant_required");
  });
});

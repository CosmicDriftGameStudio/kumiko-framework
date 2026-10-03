// § 312k contract termination: anonymous declarations through real
// HTTP (/api/write and the public pages), the account path through
// /api/write with a session, provider cancel recorded by a mock plugin, mails
// captured by the in-memory email transport after the job cascade drained.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  defineFeature,
  type FeatureDefinition,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
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
import * as z from "zod";
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
  type TerminationScope,
} from "../constants.js";
import { formatReceivedAt } from "../consumer-protection/termination-mail.js";
import { createContractTerminationRoutes } from "../consumer-protection/termination-pages.js";
import {
  CONTRACT_TERMINATION_DECLARED_EVENT_QN,
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

type TerminationStackOptions = {
  readonly terminationScope?: TerminationScope;
  readonly extraFeatures?: readonly FeatureDefinition[];
};

async function createTerminationStack(
  anonymousAccess: StackAnonymousAccess,
  stackOptions: TerminationStackOptions = {},
): Promise<TestStack> {
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
        consumerProtection: {
          ...consumerProtection,
          ...(stackOptions.terminationScope !== undefined && {
            terminationScope: stackOptions.terminationScope,
          }),
        },
      }),
      mockProviderFeature,
      ...(stackOptions.extraFeatures ?? []),
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

async function resetStack(target: TestStack): Promise<void> {
  await target.db.unsafe?.(`TRUNCATE kumiko_events, read_subscriptions, read_payments CASCADE`);
  await asRawClient(target.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(target.db).unsafe(`DELETE FROM "${templateResourcesTable.tableName}"`);
  await seedRow(target.db, templateResourcesTable, {
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
}

beforeEach(async () => {
  emailTransport.sent.length = 0;
  cancelCalls.length = 0;
  providerCancelFails = false;
  await resetStack(stack);
});

// A distinct client IP per test keeps the handler's per-IP bucket from
// leaking between tests; the bucket itself is never raised.
function nextClientIp(): string {
  ipCounter += 1;
  return `10.8.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

async function createUser(email: string, target: TestStack = stack): Promise<string> {
  const created = await target.http.writeOk<{ id: string }>(
    UserHandlers.create,
    { email, passwordHash: "not-a-real-hash", displayName: "Declarant" },
    TestUsers.systemAdmin,
  );
  return created.id;
}

async function addMember(
  userId: string,
  tenantNumber: number,
  roles: string[],
  target: TestStack = stack,
): Promise<void> {
  await target.http.writeOk(
    TenantHandlers.addMember,
    { userId, tenantId: testTenantId(tenantNumber), roles },
    TestUsers.systemAdmin,
  );
}

async function seedSubscription(
  tenantNumber: number,
  providerSubscriptionId: string,
  target: TestStack = stack,
) {
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
  const res = await target.app.request(`/api/subscription/webhook/${PROVIDER}`, {
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

async function postDeclaration(
  input: DeclarationInput,
  clientIp: string,
  target: TestStack = stack,
  headers: Record<string, string> = {},
): Promise<Response> {
  return target.app.request(
    "/api/write",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        type: SubscriptionFoundationHandlers.requestContractTermination,
        payload: declarationPayload(input),
      }),
    },
    clientIp,
  );
}

type DeclarationReceipt = { readonly requestId: string; readonly receivedAtIso: string };

async function declare(
  input: DeclarationInput,
  target: TestStack = stack,
  headers: Record<string, string> = {},
): Promise<DeclarationReceipt> {
  const res = await postDeclaration(input, nextClientIp(), target, headers);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { isSuccess: boolean; data: DeclarationReceipt };
  expect(body.isSuccess).toBe(true);
  await target.drainJobs();
  return body.data;
}

async function eventsOf(
  aggregateId: string,
  tenantId: string,
  type: string,
  target: TestStack = stack,
) {
  const events = await loadAggregate(target.db, aggregateId, tenantId as never, {
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
      // A distinct address per request: the per-recipient limit (3/day) would
      // otherwise trip before the per-IP one under test.
      const email = `ip-limit-${i}@example.com`;
      const ok = await postForm("/legal/cancel", { ...hostileFields, email, step: "confirm" }, ip);
      expect(ok.status).toBe(200);
    }
    const limited = await postForm(
      "/legal/cancel",
      { ...hostileFields, email: "ip-limit-5@example.com", step: "confirm" },
      ip,
    );
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
      // Distinct address per request, see the per-recipient limit (3/day).
      expect((await postDeclaration({ email: `ip-limit-${i}@example.com` }, ip)).status).toBe(200);
    }
    const sixth = await postDeclaration({ email: "ip-limit-5@example.com" }, ip);
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

const TENANT_HOST = "tenant-a.example.com";
const APEX_HOST = "platform.example.com";
const HOST_TENANT_NUMBER = 8200;

const unflaggedAnonymousFeature = defineFeature("test-unflagged-anonymous", (r) => {
  r.writeHandler({
    name: "ping",
    schema: z.object({}).strict(),
    access: { roles: ["anonymous"] },
    rateLimit: { per: "ip", limit: 5, windowSeconds: 600 },
    handler: async () => ({ isSuccess: true as const, data: { pong: true } }),
  });
});
const UNFLAGGED_PING_QN = "test-unflagged-anonymous:write:ping";

// Reads the Host header on purpose: the pages re-enter /api/write, which
// only sees the headers the re-entry forwards.
function hostTenantResolver(c: { req: { header: (name: string) => string | undefined } }) {
  return c.req.header("host") === TENANT_HOST ? testTenantId(HOST_TENANT_NUMBER) : null;
}

function hostAnonymousAccess(): StackAnonymousAccess {
  return {
    tenantResolver: hostTenantResolver,
    resolverTrust: "authoritative",
    tenantExists: async (id) => id === testTenantId(HOST_TENANT_NUMBER),
  };
}

async function postConfirmForm(
  target: TestStack,
  path: string,
  email: string,
  headers: Record<string, string>,
  clientIp: string = nextClientIp(),
): Promise<Response> {
  return target.app.request(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams({
        declarationType: "termination",
        terminationKind: "ordinary",
        name: DECLARANT_NAME,
        email,
        step: "confirm",
      }).toString(),
    },
    clientIp,
  );
}

async function getPage(target: TestStack, path: string, headers: Record<string, string>) {
  return target.app.request(path, { headers }, nextClientIp());
}

async function expectBothPagesServed(target: TestStack, headers: Record<string, string>) {
  for (const path of ["/legal/kuendigen", "/legal/cancel"]) {
    const res = await getPage(target, path, headers);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('name="email"');
  }
}

describe("public pages on a host-resolved tenant", () => {
  let hostStack: TestStack;

  beforeAll(async () => {
    hostStack = await createTerminationStack(hostAnonymousAccess(), {
      extraFeatures: [unflaggedAnonymousFeature],
    });
  });

  afterAll(async () => {
    await hostStack.cleanup();
  });

  beforeEach(async () => {
    await resetStack(hostStack);
  });

  test("the confirm POST on a tenant host records the declaration and cancels via the job", async () => {
    const email = "host-matched@example.com";
    const userId = await createUser(email, hostStack);
    await addMember(userId, HOST_TENANT_NUMBER, ["TenantAdmin"], hostStack);
    await seedSubscription(HOST_TENANT_NUMBER, "sub_host", hostStack);
    const headers = { host: TENANT_HOST };
    await expectBothPagesServed(hostStack, headers);

    const res = await postConfirmForm(hostStack, "/legal/kuendigen", email, headers);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Deine Erklärung ist eingegangen");
    const requestId = WRITE_REQUEST_ID_PATTERN.exec(html)?.[0] ?? "";
    await hostStack.drainJobs();

    const aggregateId = subscriptionAggregateId(testTenantId(HOST_TENANT_NUMBER));
    const declared = await eventsOf(
      aggregateId,
      testTenantId(HOST_TENANT_NUMBER),
      CONTRACT_TERMINATION_DECLARED_EVENT_QN,
      hostStack,
    );
    expect(declared.map((e) => e.payload)).toEqual([
      {
        requestId,
        declarationType: "termination",
        terminationKind: "ordinary",
        receivedAtIso: expect.any(String),
        locale: "de",
      },
    ]);
    const recorded = await eventsOf(
      aggregateId,
      testTenantId(HOST_TENANT_NUMBER),
      CONTRACT_TERMINATION_REQUESTED_EVENT_QN,
      hostStack,
    );
    expect(recorded[0]?.payload).toMatchObject({
      requestId,
      channel: "public",
      providerCancel: "period-end",
    });
    expect(cancelCalls).toEqual([{ providerSubscriptionId: "sub_host", when: "period-end" }]);
    expect(mailsTo(email)).toHaveLength(1);
  });

  test("a host that resolves no tenant still answers tenant_required, on the page and on /api/write", async () => {
    const email = "host-unknown@example.com";
    const page = await postConfirmForm(hostStack, "/legal/kuendigen", email, { host: APEX_HOST });
    expect(page.status).toBe(400);
    expect(await page.text()).not.toContain("Deine Erklärung ist eingegangen");

    const direct = await postDeclaration({ email }, nextClientIp(), hostStack, { host: APEX_HOST });
    expect(direct.status).toBe(400);
    expect(((await direct.json()) as { error: { code: string } }).error.code).toBe(
      "tenant_required",
    );
  });
});

describe("public pages in platform mode on a host that resolves no tenant", () => {
  let platformStack: TestStack;
  const apex = { host: APEX_HOST };

  beforeAll(async () => {
    platformStack = await createTerminationStack(hostAnonymousAccess(), {
      terminationScope: "platform",
      extraFeatures: [unflaggedAnonymousFeature],
    });
  });

  afterAll(async () => {
    await platformStack.cleanup();
  });

  beforeEach(async () => {
    await resetStack(platformStack);
  });

  test("both pages are served on the platform host", async () => {
    await expectBothPagesServed(platformStack, apex);
  });

  test("a matched TenantAdmin email is recorded on that tenant and cancelled by the job", async () => {
    const email = "platform-matched@example.com";
    const userId = await createUser(email, platformStack);
    await addMember(userId, 8201, ["TenantAdmin"], platformStack);
    await seedSubscription(8201, "sub_platform", platformStack);

    const res = await postConfirmForm(platformStack, "/legal/cancel", email, apex);
    expect(res.status).toBe(200);
    const requestId = WRITE_REQUEST_ID_PATTERN.exec(await res.text())?.[0] ?? "";
    await platformStack.drainJobs();

    const recorded = await eventsOf(
      subscriptionAggregateId(testTenantId(8201)),
      testTenantId(8201),
      CONTRACT_TERMINATION_REQUESTED_EVENT_QN,
      platformStack,
    );
    expect(recorded[0]?.payload).toMatchObject({
      requestId,
      channel: "public",
      providerCancel: "period-end",
    });
    expect(cancelCalls).toEqual([{ providerSubscriptionId: "sub_platform", when: "period-end" }]);
    expect(mailsTo(email)).toHaveLength(1);
    expect(mailsTo(OPERATOR_EMAIL)).toHaveLength(0);
  });

  test("unknown and ambiguous emails get the same response as a match and are recorded as unmatched", async () => {
    const matchedEmail = "platform-twin@example.com";
    const matchedUser = await createUser(matchedEmail, platformStack);
    await addMember(matchedUser, 8202, ["TenantAdmin"], platformStack);
    await seedSubscription(8202, "sub_platform_twin", platformStack);
    const ambiguousEmail = "platform-ambiguous@example.com";
    const ambiguousUser = await createUser(ambiguousEmail, platformStack);
    await addMember(ambiguousUser, 8203, ["TenantAdmin"], platformStack);
    await addMember(ambiguousUser, 8204, ["TenantAdmin"], platformStack);
    await seedSubscription(8203, "sub_platform_amb_a", platformStack);
    await seedSubscription(8204, "sub_platform_amb_b", platformStack);
    const unknownEmail = "platform-nobody@example.com";

    const responses = [];
    for (const email of [matchedEmail, unknownEmail, ambiguousEmail]) {
      const res = await postConfirmForm(platformStack, "/legal/kuendigen", email, apex);
      const html = await res.text();
      const requestId = WRITE_REQUEST_ID_PATTERN.exec(html)?.[0] ?? "";
      const receivedAtIso = /Eingegangen am: <strong>([^<]+)<\/strong>/.exec(html)?.[1] ?? "";
      responses.push({
        status: res.status,
        requestId,
        normalized: html.replaceAll(requestId, "<REQUEST_ID>").replace(receivedAtIso, "<AT>"),
      });
    }
    await platformStack.drainJobs();

    const [matched, unknown, ambiguous] = responses;
    expect(matched?.status).toBe(200);
    expect(unknown?.status).toBe(matched?.status);
    expect(ambiguous?.status).toBe(matched?.status);
    expect(unknown?.normalized).toBe(matched?.normalized);
    expect(ambiguous?.normalized).toBe(matched?.normalized);

    for (const [response, matchResult] of [
      [unknown, "none"],
      [ambiguous, "ambiguous"],
    ] as const) {
      const events = await eventsOf(
        terminationUnmatchedAggregateId(response?.requestId ?? ""),
        SYSTEM_TENANT_ID,
        CONTRACT_TERMINATION_UNMATCHED_EVENT_QN,
        platformStack,
      );
      expect(events[0]?.payload).toMatchObject({ matchResult });
    }
    expect(cancelCalls).toEqual([
      { providerSubscriptionId: "sub_platform_twin", when: "period-end" },
    ]);
    expect(mailsTo(unknownEmail)).toHaveLength(1);
    expect(mailsTo(ambiguousEmail)).toHaveLength(1);
    expect(mailsTo(OPERATOR_EMAIL)).toHaveLength(2);
  });

  test("an ambient tenant cookie on the platform host does not block the declaration", async () => {
    const email = "platform-cookie@example.com";
    const userId = await createUser(email, platformStack);
    await addMember(userId, 8205, ["TenantAdmin"], platformStack);
    await seedSubscription(8205, "sub_platform_cookie", platformStack);

    const res = await postConfirmForm(platformStack, "/legal/kuendigen", email, {
      ...apex,
      cookie: `kumiko_tenant=${testTenantId(8299)}`,
    });
    expect(res.status).toBe(200);
    await platformStack.drainJobs();

    expect(cancelCalls).toEqual([
      { providerSubscriptionId: "sub_platform_cookie", when: "period-end" },
    ]);
    expect(mailsTo(email)).toHaveLength(1);
  });

  test("the sixth confirm from one IP on the platform host gets the friendly 429 page", async () => {
    const ip = nextClientIp();
    for (let i = 0; i < 5; i += 1) {
      const ok = await postConfirmForm(
        platformStack,
        "/legal/cancel",
        `ip-limit-${i}@example.com`,
        apex,
        ip,
      );
      expect(ok.status).toBe(200);
    }
    const limited = await postConfirmForm(
      platformStack,
      "/legal/cancel",
      "ip-limit-5@example.com",
      apex,
      ip,
    );
    expect(limited.status).toBe(429);
    expect(await limited.text()).toContain("Too many requests");
  });

  test("a client-supplied tenant on the platform host does not open the exemption", async () => {
    const res = await postDeclaration({ email: "x@example.com" }, nextClientIp(), platformStack, {
      ...apex,
      "x-tenant": testTenantId(8299),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("tenant_required");
  });

  test("an unflagged anonymous handler still answers tenant_required there", async () => {
    const res = await platformStack.app.request(
      "/api/write",
      {
        method: "POST",
        headers: { "content-type": "application/json", ...apex },
        body: JSON.stringify({ type: UNFLAGGED_PING_QN, payload: {} }),
      },
      nextClientIp(),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("tenant_required");
  });

  test("/api/batch with the flagged command still answers tenant_required", async () => {
    const res = await platformStack.app.request(
      "/api/batch",
      {
        method: "POST",
        headers: { "content-type": "application/json", ...apex },
        body: JSON.stringify({
          commands: [
            {
              type: SubscriptionFoundationHandlers.requestContractTermination,
              payload: declarationPayload({ email: "batch@example.com" }),
            },
          ],
        }),
      },
      nextClientIp(),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("tenant_required");
  });
});

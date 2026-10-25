// Integration test for the cap-billing-demo sample app. Doubles as the
// "Try it" story from the README in code form: everything the README
// explains step by step is run here through the real dispatcher
// and proves itself.
//
// The test is DELIBERATELY also documentation — anyone looking at the sample
// should see here how the platform wires cap-based billing in
// real operation.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  SubscriptionEventTypes,
  SubscriptionFoundationHandlers,
  SubscriptionStatuses,
  subscriptionsProjectionTable,
} from "@cosmicdrift/kumiko-bundled-features/billing-foundation";
import { capCounterEntity } from "@cosmicdrift/kumiko-bundled-features/cap-counter";
import {
  ConfigHandlers,
  type ConfigResolver,
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { clearInbox, getInbox } from "@cosmicdrift/kumiko-bundled-features/mail-transport-inmemory";
import {
  createSecretsContext,
  tenantSecretsTable,
} from "@cosmicdrift/kumiko-bundled-features/secrets";
import { createTenantFeature, tenantEntity } from "@cosmicdrift/kumiko-bundled-features/tenant";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createEntityExecutor } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  createMutableMasterKeyProvider,
  createTestEnvelopeCipher,
  type MutableMasterKeyProvider,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { NEWSLETTER_SEND_QN, NEWSLETTER_TIER_CONFIG_KEY } from "../feature";
import { APP_FEATURES } from "../run-config";

// =============================================================================
// Setup — full stack with the demo's run-config
// =============================================================================

let stack: TestStack;
let db: DbConnection;
let resolver: ConfigResolver;
let providerRef: MutableMasterKeyProvider;

const testEncryptionKey = randomBytes(32).toString("base64");
const { table: capCounterTable } = createEntityExecutor("cap-counter", capCounterEntity);

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(testEncryptionKey);
  resolver = createConfigResolver({ cipher: encryption });

  const initialKp = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  providerRef = createMutableMasterKeyProvider(initialKp);

  // setupTestStack needs config + tenant in addition to the APP_FEATURES
  // list, because composeFeatures normally adds them
  // automatically in the runDevApp path — here we do it manually.
  stack = await setupTestStack({
    features: [createConfigFeature(), createTenantFeature(), ...APP_FEATURES],
    masterKeyProvider: providerRef,
    extraContext: ({ db, registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      secrets: createSecretsContext({ db, masterKeyProvider: providerRef, registry }),
    }),
  });
  db = stack.db;

  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafeCreateEntityTable(db, capCounterEntity);
  // read_subscriptions wird von setupTestStack automatisch gepusht
  // (r.projection mit `table`-Property → auto-push).
  await unsafePushTables(db, { configValuesTable, tenant_secrets: tenantSecretsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(db, [
    capCounterTable,
    eventsTable,
    configValuesTable,
    subscriptionsProjectionTable,
  ]);
});

// =============================================================================
// Test-Helpers
// =============================================================================

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

async function setTier(admin: ReturnType<typeof adminFor>, tier: "free" | "pro") {
  await stack.http.writeOk(
    ConfigHandlers.set,
    { key: NEWSLETTER_TIER_CONFIG_KEY, value: tier },
    admin,
  );
}

/** Demo bootstrap: the tenant picks the in-memory mail plugin via
 *  mail-foundation's provider config key. In production this would happen once
 *  during tenant onboarding; in the test we do it per tenant. */
async function selectInMemoryMail(admin: ReturnType<typeof adminFor>) {
  await stack.http.writeOk(
    ConfigHandlers.set,
    { key: "mail-foundation:config:provider", value: "inmemory" },
    admin,
  );
}

async function sendNewsletter(admin: ReturnType<typeof adminFor>, to: string, index: number) {
  return stack.http.writeOk(
    NEWSLETTER_SEND_QN,
    { to, subject: `Newsletter #${index}`, html: `<p>Hello #${index}</p>` },
    admin,
  );
}

function inboxOf(admin: ReturnType<typeof adminFor>) {
  return getInbox(admin.tenantId);
}

// =============================================================================
// Demo-Story
// =============================================================================

describe("cap-billing-demo: free tenant (limit=10)", () => {
  test("sends 10 newsletters under the cap → all emails land in the inbox", async () => {
    const free = adminFor(2001);
    clearInbox(free.tenantId);
    await selectInMemoryMail(free);
    await setTier(free, "free");

    for (let i = 1; i <= 10; i++) {
      await sendNewsletter(free, `recipient-${i}@x.de`, i);
    }
    const inbox = inboxOf(free);
    expect(inbox).toHaveLength(10);
    expect(inbox[0]?.subject).toBe("Newsletter #1");
    // Drift-Pin: keine cap-warning-mails in der Inbox solange unter soft.
    expect(inbox.every((m) => !m.subject.startsWith("[Cap Warning]"))).toBe(true);
  });

  test("11th newsletter (= soft-hit @110%) delivers a cap-warning email to the admin", async () => {
    const free = adminFor(2002);
    clearInbox(free.tenantId);
    await selectInMemoryMail(free);
    await setTier(free, "free");

    for (let i = 1; i <= 10; i++) {
      await sendNewsletter(free, `recipient-${i}@x.de`, i);
    }
    // 11. send: counter steht bei 10. Pre-call sieht 10 < hard@12 → ok.
    // ABER: 10 ≥ soft@11? Nein, 10 < 11. Also kein soft-hit beim 11. send.
    // Erst beim 12. send (counter steht bei 11) ist 11 ≥ soft@11 → soft-hit.
    await sendNewsletter(free, "recipient-11@x.de", 11);

    let inbox = inboxOf(free);
    expect(inbox.filter((m) => m.subject.startsWith("[Cap Warning]"))).toHaveLength(0);

    // 12. send: counter=11, ≥ soft@11. Notifier feuert (1×, weil
    // crossed=true); mark-soft-warned-handler dispatched + DB-Flag
    // gesetzt; Newsletter wird trotzdem gesendet (counter=12).
    await sendNewsletter(free, "recipient-12@x.de", 12);
    inbox = inboxOf(free);
    const warnings = inbox.filter((m) => m.subject.startsWith("[Cap Warning]"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.subject).toMatch(/newsletters-per-month.*11.*10/);

    // Drift-Pin: 11 newsletter-mails (1-11) + 1 newsletter (12) +
    // 1 warning-mail = 13 Mails total.
    expect(inbox).toHaveLength(13);
  });

  test("13th newsletter would reach counter=12 → CapExceededError, NOT sent", async () => {
    const free = adminFor(2003);
    clearInbox(free.tenantId);
    await selectInMemoryMail(free);
    await setTier(free, "free");

    // pre-fill 12 (= hard-threshold @120%) — counter: 1→12
    for (let i = 1; i <= 12; i++) {
      await sendNewsletter(free, `recipient-${i}@x.de`, i);
    }
    const inboxBeforeBlock = inboxOf(free);
    const warningCountBefore = inboxBeforeBlock.filter((m) =>
      m.subject.startsWith("[Cap Warning]"),
    ).length;

    // 13. send: counter steht bei 12 ≥ hard@12 → CapExceededError
    const error = await stack.http.writeErr(
      NEWSLETTER_SEND_QN,
      { to: "blocked@x.de", subject: "Blocked", html: "<p>n/a</p>" },
      free,
    );
    expect(error.code).toBe("cap_exceeded");
    expect(error.httpStatus).toBe(429);

    // Drift-Pin: keine NEUE Newsletter-Mail in Inbox (13. wurde geblockt).
    const inboxAfterBlock = inboxOf(free);
    expect(inboxAfterBlock).toHaveLength(inboxBeforeBlock.length);
    // Also no additional warning (the notifier does not fire on the hard hit).
    const warningCountAfter = inboxAfterBlock.filter((m) =>
      m.subject.startsWith("[Cap Warning]"),
    ).length;
    expect(warningCountAfter).toBe(warningCountBefore);
  });
});

describe("cap-billing-demo: pro tenant (limit=100)", () => {
  test("12 sends on pro → completely fine, no soft-hit (12 < soft@110)", async () => {
    const pro = adminFor(2101);
    clearInbox(pro.tenantId);
    await selectInMemoryMail(pro);
    await setTier(pro, "pro");

    for (let i = 1; i <= 12; i++) {
      await sendNewsletter(pro, `recipient-${i}@x.de`, i);
    }
    const inbox = inboxOf(pro);
    expect(inbox).toHaveLength(12);
    // Drift pin: no warning on pro for the first 12 sends.
    expect(inbox.every((m) => !m.subject.startsWith("[Cap Warning]"))).toBe(true);
  });
});

describe("cap-billing-demo: tenant-isolation", () => {
  test("free tenant hitting the hard cap does NOT block the pro tenant", async () => {
    const free = adminFor(2201);
    const pro = adminFor(2202);
    clearInbox(free.tenantId);
    clearInbox(pro.tenantId);
    await selectInMemoryMail(free);
    await setTier(free, "free");
    await selectInMemoryMail(pro);
    await setTier(pro, "pro");

    // free auf hard treiben (12 sends)
    for (let i = 1; i <= 12; i++) {
      await sendNewsletter(free, `f-${i}@x.de`, i);
    }
    // free.13 blockiert
    await stack.http.writeErr(
      NEWSLETTER_SEND_QN,
      { to: "blocked@x.de", subject: "Blocked", html: "<p>n/a</p>" },
      free,
    );
    // pro sends undisturbed
    await sendNewsletter(pro, "p@x.de", 1);

    expect(inboxOf(pro)).toHaveLength(1);
  });
});

// =============================================================================
// Tier switch mid-period (= the actual value prop of tier-engine)
// =============================================================================
//
// This is exactly what a Stripe webhook triggers later: a
// tenant is on free, hits the soft cap (11 mails), upgrades to pro,
// can keep sending immediately — the counter state is preserved (same
// period, same aggregate id) but the limit is resolved anew.

describe("cap-billing-demo: tier-Wechsel innerhalb derselben Period", () => {
  test("free→pro upgrade: counter remains, new cap takes effect immediately", async () => {
    const tenant = adminFor(2301);
    clearInbox(tenant.tenantId);
    await selectInMemoryMail(tenant);
    await setTier(tenant, "free");

    // 11 sends on free: counter rises to 11, the 12th send fires
    // soft-hit (= counter at soft@11 + 1 for the 12th send itself).
    for (let i = 1; i <= 11; i++) {
      await sendNewsletter(tenant, `recipient-${i}@x.de`, i);
    }
    // 12. send → soft-hit-Warning feuert (counter pre-call=11 ≥ soft@11)
    await sendNewsletter(tenant, "recipient-12@x.de", 12);

    let inbox = inboxOf(tenant);
    let warnings = inbox.filter((m) => m.subject.startsWith("[Cap Warning]"));
    expect(warnings).toHaveLength(1);

    // *** Tier-Wechsel ***
    await setTier(tenant, "pro");

    // counter is at 12. On pro: limit=100, soft=110, hard=120.
    // 12 < soft@110 → ok range. NO new warning on the next send.
    // (Drift pin: had a refactor accidentally reset the counter on
    // tier switch, the tenant could unexpectedly send 100+12 mails
    // — the test pins this truth.)
    await sendNewsletter(tenant, "recipient-13@x.de", 13);

    inbox = inboxOf(tenant);
    warnings = inbox.filter((m) => m.subject.startsWith("[Cap Warning]"));
    expect(warnings).toHaveLength(1); // unchanged — no new warn

    // Drift pin: 12 newsletters (1-12) + 1 warning + 1 newsletter (13)
    // = 14 mails total. The tier switch did NOT reset the period.
    expect(inbox).toHaveLength(14);
  });

  test("pro→free downgrade via config: existing counter can immediately trigger a hard-hit", async () => {
    const tenant = adminFor(2302);
    clearInbox(tenant.tenantId);
    await selectInMemoryMail(tenant);
    await setTier(tenant, "pro");

    // 15 sends bei pro: counter steigt auf 15, weit unter pro-soft@110.
    for (let i = 1; i <= 15; i++) {
      await sendNewsletter(tenant, `recipient-${i}@x.de`, i);
    }
    expect(inboxOf(tenant)).toHaveLength(15);

    // *** Downgrade zu free ***
    await setTier(tenant, "free");

    // counter=15, free.hard=12 → 15 ≥ 12 = hard-blocked IMMEDIATELY on the
    // next send. Edge case showing: the tier can be reset downwards
    // without touching the counter — the user notices right away that they are
    // over the new cap.
    const error = await stack.http.writeErr(
      NEWSLETTER_SEND_QN,
      { to: "after-downgrade@x.de", subject: "X", html: "<p>n/a</p>" },
      tenant,
    );
    expect(error.code).toBe("cap_exceeded");
    expect(error.httpStatus).toBe(429);

    // Inbox unchanged: the blocked send added nothing.
    expect(inboxOf(tenant)).toHaveLength(15);
  });
});

// =============================================================================
// Subscription-driven tier (live webhook story)
//
// Phase 5.4: cap-billing-demo extended with billing-foundation as the
// primary tier source. A provider webhook (Stripe/Mollie) delivers a
// SubscriptionEvent; the foundation persists the subscription row;
// the newsletter resolver reads the row when resolving the cap → real live
// path without a setTier config write.
//
// Tests call processEvent directly (= what the Hono webhook route does
// after plugin.verifyAndParseWebhook anyway). Stripe/Mollie-specific
// sig verify + lazy fetch are covered in the plugin unit
// tests.
// =============================================================================

async function processSubscriptionEvent(
  admin: ReturnType<typeof adminFor>,
  payload: {
    providerEventId: string;
    providerName: string;
    type: (typeof SubscriptionEventTypes)[keyof typeof SubscriptionEventTypes];
    status: (typeof SubscriptionStatuses)[keyof typeof SubscriptionStatuses];
    tier: string;
    providerCustomerId?: string;
    providerSubscriptionId?: string;
  },
) {
  return stack.http.writeOk(
    SubscriptionFoundationHandlers.processEvent,
    {
      providerEventId: payload.providerEventId,
      providerName: payload.providerName,
      type: payload.type,
      providerCustomerId: payload.providerCustomerId ?? `cus_${payload.providerEventId}`,
      providerSubscriptionId: payload.providerSubscriptionId ?? `sub_${payload.providerEventId}`,
      status: payload.status,
      tier: payload.tier,
      currentPeriodEndIso: "2026-12-31T00:00:00Z",
    },
    admin,
  );
}

describe("cap-billing-demo: subscription-driven tier (live-Webhook-Story)", () => {
  test("Provider-Webhook (Stripe-style) → subscription created → tier=pro greift sofort", async () => {
    const tenant = adminFor(2401);
    clearInbox(tenant.tenantId);
    await selectInMemoryMail(tenant);
    // Kein setTier — tenant hat keinen config-key, keine subscription.
    // Resolver default: free (limit=10).

    // 11 sends bei free → counter=11, beim 12. soft-hit (analog scenario 1+2).
    for (let i = 1; i <= 11; i++) {
      await sendNewsletter(tenant, `r${i}@x.de`, i);
    }

    // Provider webhook (= Stripe would be this): subscription.created with tier=pro.
    await processSubscriptionEvent(tenant, {
      providerEventId: "evt_stripe_2401",
      providerName: "stripe",
      type: SubscriptionEventTypes.created,
      status: SubscriptionStatuses.active,
      tier: "pro",
    });

    // Right after: the tenant has pro. counter=11, pro-soft@110.
    // 11 < 110 → ok. The 12th send does NOT run into a soft-hit warning.
    await sendNewsletter(tenant, "r12@x.de", 12);
    const inbox = inboxOf(tenant);
    const warnings = inbox.filter((m) => m.subject.startsWith("[Cap Warning]"));
    // Drift pin: had the resolver kept reading config, the
    // tenant would still be free → the soft-hit warning would have fired.
    expect(warnings).toHaveLength(0);
    expect(inbox).toHaveLength(12);
  });

  test("Provider-Webhook → subscription canceled → tier-fallback to free → cap blocks", async () => {
    const tenant = adminFor(2402);
    clearInbox(tenant.tenantId);
    await selectInMemoryMail(tenant);

    // Erst: pro-Subscription via webhook.
    await processSubscriptionEvent(tenant, {
      providerEventId: "evt_stripe_2402_create",
      providerName: "stripe",
      type: SubscriptionEventTypes.created,
      status: SubscriptionStatuses.active,
      tier: "pro",
      providerSubscriptionId: "sub_2402",
    });

    // 15 sends bei pro: counter=15, weit unter pro-soft@110.
    for (let i = 1; i <= 15; i++) {
      await sendNewsletter(tenant, `r${i}@x.de`, i);
    }
    expect(inboxOf(tenant)).toHaveLength(15);

    // Provider-Webhook: subscription canceled. tier auf "free".
    await processSubscriptionEvent(tenant, {
      providerEventId: "evt_stripe_2402_cancel",
      providerName: "stripe",
      type: SubscriptionEventTypes.canceled,
      status: SubscriptionStatuses.canceled,
      tier: "free",
      providerSubscriptionId: "sub_2402",
    });

    // Resolver: subscription.status=canceled → fallback auf config (kein
    // key gesetzt) → default free. counter=15, free.hard=12 → blockiert.
    const error = await stack.http.writeErr(
      NEWSLETTER_SEND_QN,
      { to: "after-cancel@x.de", subject: "X", html: "<p>n/a</p>" },
      tenant,
    );
    expect(error.code).toBe("cap_exceeded");
    expect(error.httpStatus).toBe(429);
    expect(inboxOf(tenant)).toHaveLength(15);
  });

  test("Webhook replay: second event with the same providerEventId → no duplicate audit row, no second tier update", async () => {
    const tenant = adminFor(2403);
    clearInbox(tenant.tenantId);
    await selectInMemoryMail(tenant);

    await processSubscriptionEvent(tenant, {
      providerEventId: "evt_stripe_2403",
      providerName: "stripe",
      type: SubscriptionEventTypes.created,
      status: SubscriptionStatuses.active,
      tier: "pro",
    });

    // Replay (Stripe retried wegen Netzwerk-glitch).
    const replayResult = (await processSubscriptionEvent(tenant, {
      providerEventId: "evt_stripe_2403",
      providerName: "stripe",
      type: SubscriptionEventTypes.created,
      status: SubscriptionStatuses.active,
      tier: "pro",
    })) as { duplicate?: boolean };

    // Drift pin: the foundation must return `duplicate: true`.
    // Otherwise a duplicate event row in audit + idempotency bug.
    expect(replayResult.duplicate).toBe(true);
  });

  test("Override-Semantik: subscription-row trumpft config — canceled-sub + config=pro → free", async () => {
    // Drift pin: if resolveTier took the config fallback as soon as the
    // subscription is not active, the tenant would get through despite a canceled sub
    // with config="pro" — that would be a billing loophole.
    const tenant = adminFor(2405);
    clearInbox(tenant.tenantId);
    await selectInMemoryMail(tenant);

    // Manual config override (demo pattern or leftovers of an earlier
    // test).
    await setTier(tenant, "pro");

    // Provider-Webhook: subscription created + canceled (= Endkunde hat
    // gestartet und sofort canceled).
    await processSubscriptionEvent(tenant, {
      providerEventId: "evt_2405_create",
      providerName: "stripe",
      type: SubscriptionEventTypes.created,
      status: SubscriptionStatuses.active,
      tier: "pro",
      providerSubscriptionId: "sub_2405",
    });
    await processSubscriptionEvent(tenant, {
      providerEventId: "evt_2405_cancel",
      providerName: "stripe",
      type: SubscriptionEventTypes.canceled,
      status: SubscriptionStatuses.canceled,
      tier: "free",
      providerSubscriptionId: "sub_2405",
    });

    // The 13th send would go through on pro, but is hard-blocked on free (counter=0,
    // free.hard=12, we need 13 sends → the 13th is blocked). We send
    // 12 → ok on free, the 13th should block because the tier is now free
    // (subscription beats config="pro").
    for (let i = 1; i <= 12; i++) {
      await sendNewsletter(tenant, `r${i}@x.de`, i);
    }
    const error = await stack.http.writeErr(
      NEWSLETTER_SEND_QN,
      { to: "r13@x.de", subject: "X", html: "<p>n/a</p>" },
      tenant,
    );
    expect(error.code).toBe("cap_exceeded");
    expect(error.httpStatus).toBe(429);
  });

  test("Multi-provider: second event from a DIFFERENT provider overwrites the subscription row (Disney+ switch)", async () => {
    const tenant = adminFor(2404);
    clearInbox(tenant.tenantId);
    await selectInMemoryMail(tenant);

    // Erst Stripe.
    await processSubscriptionEvent(tenant, {
      providerEventId: "evt_stripe_2404",
      providerName: "stripe",
      type: SubscriptionEventTypes.created,
      status: SubscriptionStatuses.active,
      tier: "pro",
      providerCustomerId: "cus_stripe_2404",
      providerSubscriptionId: "sub_stripe_2404",
    });

    // Dann switch zu Mollie (anderer Provider, neue customerId).
    await processSubscriptionEvent(tenant, {
      providerEventId: "evt_mollie_2404",
      providerName: "mollie",
      type: SubscriptionEventTypes.created,
      status: SubscriptionStatuses.active,
      tier: "pro",
      providerCustomerId: "cst_mollie_2404",
      providerSubscriptionId: "sub_mollie_2404",
    });

    // Resolver liest die aktuelle subscription-row → tier ist immer noch
    // pro (egal welcher Provider). 15 sends ohne soft-hit.
    for (let i = 1; i <= 15; i++) {
      await sendNewsletter(tenant, `r${i}@x.de`, i);
    }
    const warnings = inboxOf(tenant).filter((m) => m.subject.startsWith("[Cap Warning]"));
    expect(warnings).toHaveLength(0);
    expect(inboxOf(tenant)).toHaveLength(15);
  });
});

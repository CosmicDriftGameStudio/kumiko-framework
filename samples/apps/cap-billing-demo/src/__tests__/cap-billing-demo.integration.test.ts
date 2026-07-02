// Integration-Test für die cap-billing-demo Sample-App. Ist gleichzeitig
// die "Try it"-Story aus dem README in code-Form: alles was die README
// Schritt-für-Schritt erklärt, wird hier durch den echten Dispatcher
// gefahren und beweist sich selbst.
//
// Der Test ist BEWUSST auch eine Doku — wer das Sample anschaut soll
// hier sehen wie die Plattform im Realbetrieb cap-bedingtes Billing
// verdrahtet.

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
import { type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-framework/testing";
import { createEntityExecutor } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createMutableMasterKeyProvider,
  type MutableMasterKeyProvider,
  resetTestTables,
} from "@cosmicdrift/kumiko-framework/testing";
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

  // setupTestStack braucht config + tenant zusätzlich zur APP_FEATURES-
  // Liste, weil composeFeatures normalerweise im runDevApp-Pfad das
  // automatisch ergänzt — hier tun wir's manuell.
  stack = await setupTestStack({
    features: [createConfigFeature(), createTenantFeature(), ...APP_FEATURES],
    masterKeyProvider: providerRef,
    extraContext: ({ db, registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      secrets: createSecretsContext({ db, masterKeyProvider: providerRef }),
    }),
  });
  db = stack.db;

  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafeCreateEntityTable(db, capCounterEntity);
  // read_subscriptions wird von setupTestStack automatisch gepusht
  // (r.projection mit `table`-Property → auto-push).
  await unsafePushTables(db, { configValuesTable, tenant_secrets: tenantSecretsTable });
  await createEventsTable(db);
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

/** Demo-Bootstrap: tenant pickt den in-memory mail-Plugin via mail-
 *  foundation's provider-config-key. In Production würde das einmal
 *  beim Tenant-onboarding passieren; im Test rufen wir's pro Tenant. */
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
  test("sendet 10 Newsletter unter dem Cap → alle Mails landen in der Inbox", async () => {
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

  test("11. Newsletter (= soft-hit @110%) liefert eine Cap-Warning-Mail an den Admin", async () => {
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

  test("13. Newsletter würde counter=12 erreichen → CapExceededError, NICHT versendet", async () => {
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
    expect(JSON.stringify(error)).toMatch(/CapExceededError/);

    // Drift-Pin: keine NEUE Newsletter-Mail in Inbox (13. wurde geblockt).
    const inboxAfterBlock = inboxOf(free);
    expect(inboxAfterBlock).toHaveLength(inboxBeforeBlock.length);
    // Auch keine zusätzliche Warning (notifier feuert nicht beim hard-hit).
    const warningCountAfter = inboxAfterBlock.filter((m) =>
      m.subject.startsWith("[Cap Warning]"),
    ).length;
    expect(warningCountAfter).toBe(warningCountBefore);
  });
});

describe("cap-billing-demo: pro tenant (limit=100)", () => {
  test("12 sends bei pro → komplett okay, kein soft-hit (12 < soft@110)", async () => {
    const pro = adminFor(2101);
    clearInbox(pro.tenantId);
    await selectInMemoryMail(pro);
    await setTier(pro, "pro");

    for (let i = 1; i <= 12; i++) {
      await sendNewsletter(pro, `recipient-${i}@x.de`, i);
    }
    const inbox = inboxOf(pro);
    expect(inbox).toHaveLength(12);
    // Drift-Pin: keine Warning bei pro für die ersten 12 sends.
    expect(inbox.every((m) => !m.subject.startsWith("[Cap Warning]"))).toBe(true);
  });
});

describe("cap-billing-demo: tenant-isolation", () => {
  test("free-tenant am hard-cap blockiert NICHT den pro-tenant", async () => {
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
    // pro sendet ungestört
    await sendNewsletter(pro, "p@x.de", 1);

    expect(inboxOf(pro)).toHaveLength(1);
  });
});

// =============================================================================
// Tier-Wechsel mid-period (= eigentliche Value-Prop von tier-engine)
// =============================================================================
//
// Hier passiert genau das was Stripe-Webhook später triggert: ein
// Tenant ist auf free, hit den soft-Cap (11 mails), upgraded zu pro,
// kann sofort weitersenden — der counter-state bleibt erhalten (gleiche
// period, gleiche aggregate-id) aber das limit wird neu aufgelöst.

describe("cap-billing-demo: tier-Wechsel innerhalb derselben Period", () => {
  test("free→pro upgrade: counter bleibt, neuer cap greift sofort", async () => {
    const tenant = adminFor(2301);
    clearInbox(tenant.tenantId);
    await selectInMemoryMail(tenant);
    await setTier(tenant, "free");

    // 11 sends bei free: counter steigt auf 11, beim 12. send wird's
    // soft-hit-fired (= counter at soft@11 + 1 für den 12. send selbst).
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

    // counter steht bei 12. Bei pro: limit=100, soft=110, hard=120.
    // 12 < soft@110 → ok-Bereich. KEINE neue Warning beim nächsten send.
    // (Drift-Pin: hätte ein Refactor versehentlich den counter beim
    // Tier-Wechsel resettet, würde der Tenant unvermutet 100+12 mails
    // senden können — diese Wahrheit pin'd der Test.)
    await sendNewsletter(tenant, "recipient-13@x.de", 13);

    inbox = inboxOf(tenant);
    warnings = inbox.filter((m) => m.subject.startsWith("[Cap Warning]"));
    expect(warnings).toHaveLength(1); // unverändert — kein neuer warn

    // Drift-Pin: 12 newsletter (1-12) + 1 warning + 1 newsletter (13)
    // = 14 mails total. Tier-Wechsel hat NICHT die period zurückgesetzt.
    expect(inbox).toHaveLength(14);
  });

  test("pro→free downgrade via config: existing counter kann sofort hard-hit auslösen", async () => {
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

    // counter=15, free.hard=12 → 15 ≥ 12 = SOFORT hard-blocked beim
    // nächsten send. Edge-case der zeigt: tier kann nach unten resettet
    // werden ohne den counter zu touchen — User merkt sofort dass er
    // über dem neuen cap ist.
    const error = await stack.http.writeErr(
      NEWSLETTER_SEND_QN,
      { to: "after-downgrade@x.de", subject: "X", html: "<p>n/a</p>" },
      tenant,
    );
    expect(JSON.stringify(error)).toMatch(/CapExceededError/);

    // Inbox unverändert: blockierter send hat nichts hinzugefügt.
    expect(inboxOf(tenant)).toHaveLength(15);
  });
});

// =============================================================================
// Subscription-driven tier (live-Webhook-Story)
//
// Phase 5.4: cap-billing-demo erweitert um billing-foundation als
// primary tier-source. Provider-Webhook (Stripe/Mollie) liefert ein
// SubscriptionEvent; foundation persistiert die subscription-row;
// newsletter-resolver liest die row beim cap-Auflösen → echter live-
// Pfad ohne setTier-config-write.
//
// Tests rufen processEvent direkt (= das was die Hono-webhook-route
// nach dem plugin.verifyAndParseWebhook ohnehin tut). Stripe-/Mollie-
// spezifische sig-verify + lazy-fetch sind in den Plugin-Unit-Tests
// abgedeckt.
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
      rawPayload: '{"raw":"webhook-test"}',
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

    // Provider-Webhook (= Stripe wäre's): subscription.created mit tier=pro.
    await processSubscriptionEvent(tenant, {
      providerEventId: "evt_stripe_2401",
      providerName: "stripe",
      type: SubscriptionEventTypes.created,
      status: SubscriptionStatuses.active,
      tier: "pro",
    });

    // Sofort danach: der Tenant hat pro. counter=11, pro-soft@110.
    // 11 < 110 → ok. 12. send läuft NICHT in soft-hit-warning.
    await sendNewsletter(tenant, "r12@x.de", 12);
    const inbox = inboxOf(tenant);
    const warnings = inbox.filter((m) => m.subject.startsWith("[Cap Warning]"));
    // Drift-Pin: hätte der resolver weiterhin config gelesen, wäre der
    // tenant immer noch free → soft-hit-warning hätte gefeuert.
    expect(warnings).toHaveLength(0);
    expect(inbox).toHaveLength(12);
  });

  test("Provider-Webhook → subscription canceled → tier-fallback auf free → cap blockiert", async () => {
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
    });

    // Resolver: subscription.status=canceled → fallback auf config (kein
    // key gesetzt) → default free. counter=15, free.hard=12 → blockiert.
    const error = await stack.http.writeErr(
      NEWSLETTER_SEND_QN,
      { to: "after-cancel@x.de", subject: "X", html: "<p>n/a</p>" },
      tenant,
    );
    expect(JSON.stringify(error)).toMatch(/CapExceededError/);
    expect(inboxOf(tenant)).toHaveLength(15);
  });

  test("Webhook-Replay: zweiter event mit selber providerEventId → keine doppelte audit-row, kein zweiter tier-update", async () => {
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

    // Drift-Pin: foundation muss `duplicate: true` zurückgeben.
    // Sonst doppelte event-row in audit + idempotency-bug.
    expect(replayResult.duplicate).toBe(true);
  });

  test("Override-Semantik: subscription-row trumpft config — canceled-sub + config=pro → free", async () => {
    // Drift-Pin: würde resolveTier den config-fallback nehmen sobald
    // subscription nicht active ist, käme der Tenant trotz canceled-sub
    // mit config="pro" weiter durch — das wäre ein Billing-Loophole.
    const tenant = adminFor(2405);
    clearInbox(tenant.tenantId);
    await selectInMemoryMail(tenant);

    // Manueller config-override (Demo-Pattern oder Reste eines früheren
    // Tests).
    await setTier(tenant, "pro");

    // Provider-Webhook: subscription created + canceled (= Endkunde hat
    // gestartet und sofort canceled).
    await processSubscriptionEvent(tenant, {
      providerEventId: "evt_2405_create",
      providerName: "stripe",
      type: SubscriptionEventTypes.created,
      status: SubscriptionStatuses.active,
      tier: "pro",
    });
    await processSubscriptionEvent(tenant, {
      providerEventId: "evt_2405_cancel",
      providerName: "stripe",
      type: SubscriptionEventTypes.canceled,
      status: SubscriptionStatuses.canceled,
      tier: "free",
    });

    // 13. send würde bei pro durchgehen, bei free hard-blockt (counter=0,
    // free.hard=12, brauchen 13 sends → 13. blockiert). Wir schicken
    // 12 → ok bei free, der 13. sollte blocken weil tier ist nun free
    // (subscription trumpft config="pro").
    for (let i = 1; i <= 12; i++) {
      await sendNewsletter(tenant, `r${i}@x.de`, i);
    }
    const error = await stack.http.writeErr(
      NEWSLETTER_SEND_QN,
      { to: "r13@x.de", subject: "X", html: "<p>n/a</p>" },
      tenant,
    );
    expect(JSON.stringify(error)).toMatch(/CapExceededError/);
  });

  test("Multi-Provider: zweiter event von ANDEREM provider überschreibt subscription-row (Disney+-Wechsel)", async () => {
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

// Integration-Test für die cap-billing-demo Sample-App. Ist gleichzeitig
// die "Try it"-Story aus dem README in code-Form: alles was die README
// Schritt-für-Schritt erklärt, wird hier durch den echten Dispatcher
// gefahren und beweist sich selbst.
//
// Der Test ist BEWUSST auch eine Doku — wer das Sample anschaut soll
// hier sehen wie die Plattform im Realbetrieb cap-bedingtes Billing
// verdrahtet.

import { randomBytes } from "node:crypto";
import { capCounterEntity } from "@kumiko/bundled-features/cap-counter";
import {
  ConfigHandlers,
  type ConfigResolver,
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@kumiko/bundled-features/config";
import { clearInbox, getInbox } from "@kumiko/bundled-features/mail-transport-inmemory";
import { createSecretsContext, tenantSecretsTable } from "@kumiko/bundled-features/secrets";
import { createTenantFeature, tenantEntity } from "@kumiko/bundled-features/tenant";
import { createEncryptionProvider, type DbConnection } from "@kumiko/framework/db";
import { createEventsTable } from "@kumiko/framework/event-store";
import { createEnvMasterKeyProvider } from "@kumiko/framework/secrets";
import {
  createEntityTable,
  createTestUser,
  pushTables,
  setupTestStack,
  type TestStack,
  testTenantId,
} from "@kumiko/framework/stack";
import {
  createMutableMasterKeyProvider,
  type MutableMasterKeyProvider,
} from "@kumiko/framework/testing";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
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

beforeAll(async () => {
  const encryption = createEncryptionProvider(testEncryptionKey);
  resolver = createConfigResolver({ encryption });

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

  await createEntityTable(db, tenantEntity);
  await createEntityTable(db, capCounterEntity);
  await pushTables(db, { configValuesTable, tenant_secrets: tenantSecretsTable });
  await createEventsTable(db);
});

afterAll(async () => {
  await stack.cleanup();
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

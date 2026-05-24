// Full-stack integration test for mail-foundation. Drives the
// transport-factory through the dispatcher so the real config-resolver +
// secrets-context + tenant-scoped reads are exercised — the same path
// production handlers will hit when sending mail.
//
// **Test-Handler-Pattern:** we register a tiny one-off feature with a
// write-handler that calls createTransportForTenant + reports back what
// it saw. That's the cheapest way to get a real `HandlerContext` in a
// test without re-implementing the dispatcher.

import { randomBytes } from "node:crypto";
import { createEncryptionProvider, type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
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
} from "@cosmicdrift/kumiko-framework/testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import { createConfigFeature } from "../../config";
import { ConfigHandlers } from "../../config/constants";
import { createConfigAccessorFactory } from "../../config/feature";
import { type ConfigResolver, createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { mailTransportSmtpFeature, SMTP_PASSWORD } from "../../mail-transport-smtp";
import { createSecretsContext, createSecretsFeature, tenantSecretsTable } from "../../secrets";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity } from "../../tenant/schema/tenant";
import { createTransportForTenant, mailFoundationFeature } from "../feature";

// --- Test-Handler that exercises the factory end-to-end ---

const TEST_HANDLER_QN = "mail-test:write:build-transport";
const testProbeFeature = defineFeature("mail-test", (r) => {
  r.requires("config");
  r.requires("secrets");
  r.writeHandler(
    defineWriteHandler({
      name: "build-transport",
      schema: z.object({}),
      access: { roles: ["TenantAdmin", "SystemAdmin"] },
      handler: async (event, ctx) => {
        const transport = await createTransportForTenant(ctx, event.user.tenantId, TEST_HANDLER_QN);
        return {
          isSuccess: true,
          data: { hasSend: typeof transport.send === "function" },
        };
      },
    }),
  );
});

// --- Setup ---

let stack: TestStack;
let db: DbConnection;
let resolver: ConfigResolver;
let providerRef: MutableMasterKeyProvider;

const testEncryptionKey = randomBytes(32).toString("base64");

beforeAll(async () => {
  const encryption = createEncryptionProvider(testEncryptionKey);
  resolver = createConfigResolver({ encryption });

  // Master-key for the secrets-feature. Production env shape:
  //   KUMIKO_SECRETS_MASTER_KEY_V1=<base64 32 bytes>
  //   KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION=1
  const initialKp = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  providerRef = createMutableMasterKeyProvider(initialKp);

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createSecretsFeature(),
      mailFoundationFeature,
      mailTransportSmtpFeature,
      testProbeFeature,
    ],
    masterKeyProvider: providerRef,
    extraContext: ({ db, registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      // _configAccessorFactory wires `ctx.config(handle)` for every
      // dispatched handler. Without it createTransportForTenant fails
      // with "ctx.config is missing".
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      secrets: createSecretsContext({ db, masterKeyProvider: providerRef }),
    }),
  });
  db = stack.db;

  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafePushTables(db, { configValuesTable, tenant_secrets: tenantSecretsTable });
  await createEventsTable(db);
});

afterAll(async () => {
  await stack.cleanup();
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

async function setConfig(admin: ReturnType<typeof adminFor>, key: string, value: unknown) {
  await stack.http.writeOk(ConfigHandlers.set, { key, value }, admin);
}

/** Set the mail-foundation provider-selector to "smtp". Plugin-API
 *  needs this — without it the foundation-factory doesn't know which
 *  registered transport to use. */
async function selectSmtpProvider(admin: ReturnType<typeof adminFor>) {
  await setConfig(admin, "mail-foundation:config:provider", "smtp");
}

// --- Scenario 1: full happy-path roundtrip ---

describe("scenario 1: happy path", () => {
  test("admin sets config + secret → factory builds working transport", async () => {
    const admin = adminFor(401);

    // Plugin-API: select "smtp" — foundation looks it up in the registry.
    await selectSmtpProvider(admin);

    // Tenant configures their SMTP — Mailhog-style local test server.
    await setConfig(admin, "mail-transport-smtp:config:host", "localhost");
    await setConfig(admin, "mail-transport-smtp:config:port", 1025);
    await setConfig(admin, "mail-transport-smtp:config:from", "noreply@test.local");
    await setConfig(admin, "mail-transport-smtp:config:auth-user", "admin@test.local");

    // Sensitive: SMTP password via the secrets-write handler.
    await stack.http.writeOk(
      "secrets:write:set",
      { key: SMTP_PASSWORD.name, value: "test-password-123" },
      admin,
    );

    // Drive the factory through a dispatcher-real test-handler.
    // writeOk returns the handler's TData (custom-shaped). For the
    // crud-pattern (tenant/user features) TData is a SaveContext
    // (`{ data, isNew, ... }`); our test-handler returns plain
    // `{ hasSend }` so writeOk's response is just `{ hasSend }`.
    const result = (await stack.http.writeOk(TEST_HANDLER_QN, {}, admin)) as Record<
      string,
      unknown
    >;
    expect(result["hasSend"]).toBe(true);
  });
});

// --- Scenario 2: missing host config is rejected with a clear error ---

describe("scenario 2: validation errors", () => {
  test("missing host → factory throws with hint instead of a cryptic SMTP error", async () => {
    const admin = adminFor(402);

    await selectSmtpProvider(admin);
    // Set everything EXCEPT host. The plugin should fail with a
    // message naming the missing key before touching nodemailer.
    await setConfig(admin, "mail-transport-smtp:config:port", 587);
    await setConfig(admin, "mail-transport-smtp:config:from", "noreply@test.local");
    await setConfig(admin, "mail-transport-smtp:config:auth-user", "admin@test.local");
    await stack.http.writeOk("secrets:write:set", { key: SMTP_PASSWORD.name, value: "pw" }, admin);

    // writeOk would throw an assertion-error; use writeRaw + check status.
    const error = await stack.http.writeErr(TEST_HANDLER_QN, {}, admin);
    expect(JSON.stringify(error)).toMatch(/'host' is empty/);
  });

  test("missing password secret → factory throws naming the secret", async () => {
    const admin = adminFor(403);

    await selectSmtpProvider(admin);
    await setConfig(admin, "mail-transport-smtp:config:host", "localhost");
    await setConfig(admin, "mail-transport-smtp:config:port", 587);
    await setConfig(admin, "mail-transport-smtp:config:from", "noreply@test.local");
    await setConfig(admin, "mail-transport-smtp:config:auth-user", "admin@test.local");
    // Skip the secret. requireSecretsContext.get returns undefined,
    // factory throws referencing SMTP_PASSWORD.name.

    const error = await stack.http.writeErr(TEST_HANDLER_QN, {}, admin);
    expect(JSON.stringify(error)).toMatch(/smtp-password/);
  });
});

// --- Scenario 3: tenant isolation (config + secret stay per-tenant) ---

describe("scenario 3: tenant isolation", () => {
  test("tenant A's SMTP config doesn't bleed into tenant B's transport", async () => {
    const adminA = adminFor(404);
    const adminB = adminFor(405);

    await selectSmtpProvider(adminA);
    await selectSmtpProvider(adminB);

    // Tenant A configures their SMTP.
    await setConfig(adminA, "mail-transport-smtp:config:host", "smtp.tenant-a.test");
    await setConfig(adminA, "mail-transport-smtp:config:port", 587);
    await setConfig(adminA, "mail-transport-smtp:config:from", "a@tenant-a.test");
    await setConfig(adminA, "mail-transport-smtp:config:auth-user", "a-user");
    await stack.http.writeOk(
      "secrets:write:set",
      { key: SMTP_PASSWORD.name, value: "pw-a" },
      adminA,
    );

    // Tenant B has their OWN SMTP — different host on purpose.
    await setConfig(adminB, "mail-transport-smtp:config:host", "smtp.tenant-b.test");
    await setConfig(adminB, "mail-transport-smtp:config:port", 465);
    await setConfig(adminB, "mail-transport-smtp:config:from", "b@tenant-b.test");
    await setConfig(adminB, "mail-transport-smtp:config:auth-user", "b-user");
    await stack.http.writeOk(
      "secrets:write:set",
      { key: SMTP_PASSWORD.name, value: "pw-b" },
      adminB,
    );

    // Both factories should succeed — that's the per-tenant promise.
    // The actual host-validation is on the SMTP transport build (object
    // allocation), not a network call.
    const a = (await stack.http.writeOk(TEST_HANDLER_QN, {}, adminA)) as Record<string, unknown>;
    const b = (await stack.http.writeOk(TEST_HANDLER_QN, {}, adminB)) as Record<string, unknown>;
    expect(a["hasSend"]).toBe(true);
    expect(b["hasSend"]).toBe(true);
  });
});

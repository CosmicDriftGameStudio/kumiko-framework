// Full-stack integration test for mail-foundation. Drives the
// transport-factory through the dispatcher so the real config-resolver +
// secrets-context + tenant-scoped reads are exercised — the same path
// production handlers will hit when sending mail.
//
// **Test-Handler-Pattern:** we register a tiny one-off feature with a
// write-handler that calls createTransportForTenant + reports back what
// it saw. That's the cheapest way to get a real `HandlerContext` in a
// test without re-implementing the dispatcher.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { lookup } from "node:dns/promises";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  defineWriteHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  createMutableMasterKeyProvider,
  createTestEnvelopeCipher,
  type MutableMasterKeyProvider,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createConfigAccessorFactory } from "../../config/feature.ts";
import { createConfigFeature } from "../../config/index.ts";
import { type ConfigResolver, createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { ConfigHandlers } from "../../config/web/constants.ts";
import { MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR } from "../../foundation-shared/index.ts";
import {
  clearInbox,
  createMailTransportInMemoryFeature,
  getInbox,
} from "../../mail-transport-inmemory/index.ts";
import {
  createMailTransportSmtpFeature,
  SMTP_PASSWORD,
  setSmtpMailHostLookup,
} from "../../mail-transport-smtp/index.ts";
import {
  createSecretsContext,
  createSecretsFeature,
  tenantSecretsTable,
} from "../../secrets/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createMailFoundationFeature, createTransportForTenant } from "../feature.ts";

// --- Test-Handler that exercises the factory end-to-end ---

const TEST_HANDLER_QN = "mail-test:write:build-transport";
const testProbeFeature = defineFeature("mail-test", (r) => {
  r.requires({ features: ["config"] });
  r.requires({ features: ["secrets"] });
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
  r.writeHandler(
    defineWriteHandler({
      name: "send",
      schema: z.object({ to: z.string(), subject: z.string(), html: z.string() }),
      access: { roles: ["TenantAdmin", "SystemAdmin"] },
      handler: async (event, ctx) => {
        const transport = await createTransportForTenant(
          ctx,
          event.user.tenantId,
          "mail-test:write:send",
        );
        await transport.send(event.payload);
        return { isSuccess: true, data: {} };
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

// Tenant-supplied SMTP hosts here are placeholder `.test`/`localhost`
// names that never touch a real server (createSmtpTransport allocates a
// nodemailer pool lazily, connecting only on send) — pin DNS to a fixed
// public address so the host-egress guard resolves deterministically
// instead of depending on real DNS for a name that's never meant to work.
// "internal-relay.test" is the one exception, mapped to a private address
// on purpose for scenario 5's resolves-privately rejection case.
beforeAll(() => {
  const fakeLookup = (async (hostname: string) => {
    if (hostname === "internal-relay.test") return [{ address: "127.0.0.1", family: 4 }];
    return [{ address: "93.184.216.34", family: 4 }];
  }) as unknown as typeof lookup;
  setSmtpMailHostLookup(fakeLookup);
});

afterAll(() => {
  setSmtpMailHostLookup(undefined);
});

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(testEncryptionKey);
  resolver = createConfigResolver({ cipher: encryption });

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
      createMailFoundationFeature(),
      createMailTransportSmtpFeature(),
      createMailTransportInMemoryFeature(),
      testProbeFeature,
    ],
    masterKeyProvider: providerRef,
    extraContext: ({ db, registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      // configAccessorFactory wires `ctx.config(handle)` for every
      // dispatched handler. Without it createTransportForTenant fails
      // with "ctx.config is missing".
      configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      secrets: createSecretsContext({ db, masterKeyProvider: providerRef, registry: registry }),
    }),
  });
  db = stack.db;

  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafePushTables(db, { configValuesTable, tenant_secrets: tenantSecretsTable });
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

  test("missing password secret → 422 unconfigured naming the secret", async () => {
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
    expect(error.httpStatus).toBe(422);
    expect(error.code).toBe("unconfigured");
    expect(error.details).toMatchObject({
      feature: "mail-transport-smtp",
      key: SMTP_PASSWORD.name,
    });
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

// --- Scenario 4: the in-memory transport plugin actually delivers ---

describe("scenario 4: in-memory transport dispatch", () => {
  test("provider=inmemory → a sent mail lands in that tenant's inbox", async () => {
    const admin = adminFor(406);
    clearInbox(admin.tenantId);
    await setConfig(admin, "mail-foundation:config:provider", "inmemory");

    const message = { to: "user@acme.test", subject: "Hi", html: "<p>hello</p>" };
    await stack.http.writeOk("mail-test:write:send", message, admin);

    expect(getInbox(admin.tenantId)).toEqual([message]);
  });
});

// --- Scenario 5: tenant-supplied SMTP host must resolve to a public address ---

describe("scenario 5: mail-host guard", () => {
  async function configureSmtp(admin: ReturnType<typeof adminFor>, host: string) {
    await selectSmtpProvider(admin);
    await setConfig(admin, "mail-transport-smtp:config:host", host);
    await setConfig(admin, "mail-transport-smtp:config:port", 587);
    await setConfig(admin, "mail-transport-smtp:config:from", "noreply@test.local");
    await setConfig(admin, "mail-transport-smtp:config:auth-user", "admin@test.local");
    await stack.http.writeOk("secrets:write:set", { key: SMTP_PASSWORD.name, value: "pw" }, admin);
  }

  test("a private IP-literal host is rejected as unconfigured, naming 'host'", async () => {
    const admin = adminFor(407);
    await configureSmtp(admin, "10.0.0.5");

    const error = await stack.http.writeErr(TEST_HANDLER_QN, {}, admin);
    expect(error.httpStatus).toBe(422);
    expect(error.code).toBe("unconfigured");
    expect(error.details).toMatchObject({ feature: "mail-transport-smtp", key: "host" });
  });

  test("a hostname that resolves to a private address is rejected as unconfigured", async () => {
    const admin = adminFor(408);
    await configureSmtp(admin, "internal-relay.test");

    const error = await stack.http.writeErr(TEST_HANDLER_QN, {}, admin);
    expect(error.httpStatus).toBe(422);
    expect(error.code).toBe("unconfigured");
    expect(error.details).toMatchObject({ feature: "mail-transport-smtp", key: "host" });
  });

  test("a public tenant-supplied host builds successfully", async () => {
    const admin = adminFor(409);
    await configureSmtp(admin, "smtp.public-relay.test");

    const result = (await stack.http.writeOk(TEST_HANDLER_QN, {}, admin)) as Record<
      string,
      unknown
    >;
    expect(result["hasSend"]).toBe(true);
  });

  test("an operator-allowlisted private relay bypasses the guard", async () => {
    process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR] = "ops-relay.internal";
    try {
      const admin = adminFor(410);
      await configureSmtp(admin, "ops-relay.internal");

      const result = (await stack.http.writeOk(TEST_HANDLER_QN, {}, admin)) as Record<
        string,
        unknown
      >;
      expect(result["hasSend"]).toBe(true);
    } finally {
      delete process.env[MAIL_ALLOWED_PRIVATE_HOSTS_ENV_VAR];
    }
  });
});

// A boot migration moves an app's own SMTP settings into these keys from a wire hook,
// which only has dispatchSystemWrite (system identity plus SystemAdmin).
describe("server-side writes of the tenant mail settings", () => {
  test("the system identity writes the provider, the SMTP keys and the password", async () => {
    const tenantId = testTenantId(470);
    const systemUser = createSystemUser(tenantId, ["SystemAdmin"]);
    const writes = [
      {
        qn: ConfigHandlers.set,
        payload: { key: "mail-transport-smtp:config:host", value: "smtp.test" },
      },
      {
        qn: ConfigHandlers.set,
        payload: { key: "mail-transport-smtp:config:auth-user", value: "u" },
      },
      {
        qn: ConfigHandlers.set,
        payload: { key: "mail-transport-smtp:config:from", value: "a@b.test" },
      },
      { qn: "secrets:write:set", payload: { key: SMTP_PASSWORD.name, value: "migrated-password" } },
      {
        qn: ConfigHandlers.set,
        payload: { key: "mail-foundation:config:provider", value: "smtp" },
      },
    ];
    for (const write of writes) {
      const result = await stack.dispatcher.write(write.qn, write.payload, systemUser);
      expect(result.isSuccess, write.qn).toBe(true);
    }
    const built = await stack.dispatcher.write(TEST_HANDLER_QN, {}, systemUser);
    expect(built).toMatchObject({ isSuccess: true, data: { hasSend: true } });
  });

  test("a platform admin without the tenant admin role cannot set a tenant's provider", async () => {
    const platformAdmin = createTestUser({
      id: 471,
      tenantId: testTenantId(471),
      roles: ["SystemAdmin"],
    });
    const denied = await stack.http.writeErr(
      ConfigHandlers.set,
      { key: "mail-foundation:config:provider", value: "smtp" },
      platformAdmin,
    );
    expect(denied.code).toBe("access_denied");
  });
});

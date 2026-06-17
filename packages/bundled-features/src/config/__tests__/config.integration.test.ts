import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEncryptionProvider,
  type DbConnection,
  seedConfigValues,
} from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createSeed,
  createSystemConfig,
  createSystemSeed,
  createTenantConfig,
  createUserConfig,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-framework/testing";
import { z } from "zod";
import { ConfigHandlers, ConfigQueries } from "../constants";
import { createConfigAccessor, createConfigAccessorFactory, createConfigFeature } from "../feature";
import { type ConfigResolver, createConfigResolver, validateAppOverrides } from "../resolver";
import { configValueEntity, configValuesTable } from "../table";

// --- Setup ---

let stack: TestStack;
let db: DbConnection;
let resolver: ConfigResolver;

const systemAdmin = TestUsers.systemAdmin;
const tenantAdmin = createTestUser({ id: 2 });
const billingUser = createTestUser({ id: 3, roles: ["Billing"] });
const normalUser = createTestUser({ id: 4, roles: ["User"] });
const otherTenantAdmin = createTestUser({
  id: 5,
  tenantId: "00000000-0000-4000-8000-000000000002",
});

// --- Features that register config keys (based on 6 real scenarios) ---

// Scenario 1: System URL — one value for the whole system
// Scenario 2: Mail server — system default + tenant override
const appFeature = defineFeature("app", (r) => {
  r.requires("config");

  r.config({
    keys: {
      // Scenario 1: system-only URL
      serviceUrl: createSystemConfig("text", {
        default: "https://default.example.com",
        write: access.systemAdmin,
      }),
      // Scenario 2: mail server with system default + tenant override
      mailServer: createTenantConfig("text", {
        default: "smtp.default.com",
        write: access.roles("SystemAdmin", "Admin"),
        read: access.admin,
      }),
    },
  });
});

// Scenario 3: Tenant mail signature — admin can change
// Scenario 4: Tenant invoice pattern — billing can change
const invoicingFeature = defineFeature("invoicing", (r) => {
  r.requires("config");

  r.config({
    keys: {
      // Scenario 3
      mailSignature: createTenantConfig("text", {
        default: "Best regards",
        write: access.roles("Admin"),
      }),
      // Scenario 4
      invoicePattern: createTenantConfig("text", {
        default: "INV-{year}-{number}",
        write: access.roles("Billing"),
        read: access.roles("Admin", "Billing"),
      }),
    },
  });
});

// Scenario 5: User push notification setting. Setup-return becomes
// `notificationsFeature.exports` (defineFeature generic) — that's how the
// probe handler below reaches the typed handle without module-capture.
const notificationsFeature = defineFeature("notifications", (r) => {
  r.requires("config");
  return r.config({
    keys: {
      pushEnabled: createUserConfig("boolean", { default: true }),
    },
  });
});

// Scenario 6: Feature setting per tenant
const ordersFeature = defineFeature("orders", (r) => {
  r.requires("config");
  return r.config({
    keys: {
      maxOrderCount: createTenantConfig("number", { default: 100, write: access.roles("Admin") }),
      // Scenario 7: numeric key with bounds — reject-path for out-of-range values.
      maxUploadSizeMB: createTenantConfig("number", {
        default: 10,
        bounds: { min: 1, max: 1000 },
        write: access.roles("Admin"),
      }),
      // Scenario 9: computed key — simulates plan-based quota. Fake-lookup
      // by tenantId suffix so the test stays hermetic. In a real app,
      // computed would `ctx.db.select()...` a subscription table.
      planBasedQuotaGB: createTenantConfig("number", {
        default: 1,
        write: access.roles("Admin"),
        computed: async ({ tenantId }) => {
          // Tenant 2 = "Pro" plan, everyone else gets basic.
          if (tenantId.endsWith("0000000002")) return 500;
          return 50;
        },
      }),
    },
  });
});

// Probe feature: a real writeHandler reads two configs through ctx.config
// so the dispatcher-wiring path is exercised end-to-end (not just the
// factory in isolation). Captures the resolved values for the test to assert.
const probe: { orders: number | undefined; push: boolean | undefined } = {
  orders: undefined,
  push: undefined,
};
const probeFeature = defineFeature("probe", (r) => {
  r.requires("config");
  r.requires("orders");
  r.requires("notifications");

  r.writeHandler(
    "read-config",
    z.object({}),
    async (_event, ctx) => {
      if (!ctx.config) throw new Error("ctx.config not wired — _configAccessorFactory missing");
      probe.orders = await ctx.config(ordersFeature.exports.maxOrderCount);
      probe.push = await ctx.config(notificationsFeature.exports.pushEnabled);
      return { isSuccess: true, data: { orders: probe.orders, push: probe.push } };
    },
    { access: { openToAll: true } },
  );
});

// Encrypted config key
const integrationFeature = defineFeature("integration", (r) => {
  r.requires("config");

  r.config({
    keys: {
      apiSecret: createTenantConfig("text", {
        write: access.systemAdmin,
        read: access.systemAdmin,
        encrypted: true,
      }),
      // Dedicated key for the lifecycle-event tests below. Kept in its own
      // key so `.created` / `.updated` assertions don't race with earlier
      // scenarios that mutate shared keys (max-order-count etc.).
      lifecycleProbe: createTenantConfig("text", {
        default: "initial",
        write: access.roles("Admin"),
      }),
      // Settings-Hub system-scope proxies for the derived Stripe screen: a
      // privileged boolean (billing-live = machine OR human-SystemAdmin) and
      // an encrypted system secret (api-key). Both are surfaced to a human
      // SystemAdmin by build-config-feature-schema and must be SET-able by them.
      billingLive: createSystemConfig("boolean", {
        default: false,
        write: access.privileged,
        read: access.admin,
      }),
      systemSecret: createSystemConfig("text", {
        write: access.systemAdmin,
        read: access.systemAdmin,
        encrypted: true,
      }),
    },
  });
});

const configFeature = createConfigFeature();

// Pattern-validated text key (managed-cms phase 3 core change): set.write runs
// keyDef.pattern as a hard-reject gate, same posture as bounds. The regex
// allows empty (clear) | a CSS hex color.
const patternFeature = defineFeature("patterned", (r) => {
  r.requires("config");
  r.config({
    keys: {
      hexColor: createTenantConfig("text", {
        default: "",
        write: access.roles("Admin"),
        pattern: { regex: "^$|^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$" },
      }),
    },
  });
});

// Scenario 11: Config seeding — feature with deploy-time defaults
const seedFeature = defineFeature("seeddemo", (r) => {
  r.requires("config");
  return r.config({
    keys: {
      themeColor: createTenantConfig("text", { default: "blue" }),
      maintenanceMode: createSystemConfig("boolean", { default: false }),
    },
    seeds: {
      themeColor: createSeed({ value: "dark" }),
      maintenanceMode: createSystemSeed({ value: true }),
    },
  });
});

// Readiness-Scenario: required keys — feature is unusable until the tenant
// sets real values (mirrors mail-transport-smtp / file-provider-s3).
const transportFeature = defineFeature("transport", (r) => {
  r.requires("config");
  return r.config({
    keys: {
      smtpHost: createTenantConfig("text", {
        required: true,
        default: "",
        write: access.roles("Admin"),
        read: access.admin,
      }),
      apiUrl: createTenantConfig("text", {
        required: true,
        default: "",
        write: access.roles("Admin"),
      }),
      // Stays unset for the whole suite — read-access tests rely on it.
      webhookUrl: createTenantConfig("text", {
        required: true,
        default: "",
        write: access.roles("Admin"),
      }),
      timeout: createTenantConfig("number", {
        required: true,
        write: access.roles("Admin"),
      }),
    },
  });
});

const testEncryptionKey = randomBytes(32).toString("base64");

beforeAll(async () => {
  const encryption = createEncryptionProvider(testEncryptionKey);
  resolver = createConfigResolver({ encryption });

  stack = await setupTestStack({
    features: [
      configFeature,
      appFeature,
      invoicingFeature,
      notificationsFeature,
      ordersFeature,
      integrationFeature,
      probeFeature,
      seedFeature,
      transportFeature,
      patternFeature,
    ],
    // Wire `ctx.config()` for real handlers: pass the resolver-bound factory
    // so the dispatcher can mint a per-user accessor inside buildHandlerContext.
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      configEncryption: encryption,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  db = stack.db;

  await unsafePushTables(db, { configValuesTable });
  // setupTestStack already calls createEventsTable + createArchivedStreamsTable
  // for us; nothing extra needed for the config-changed event-store writes.
});

afterAll(async () => {
  await stack.cleanup();
});

// --- Scenario 1: System URL — einmal pro System ---

describe("scenario 1: system-scoped service URL", () => {
  test("returns default when no value is set", async () => {
    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );
    const value = await configFn("app:config:service-url");
    expect(value).toBe("https://default.example.com");
  });

  test("SystemAdmin can set system-scoped value", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      {
        key: "app:config:service-url",
        value: "https://custom.example.com",
      },
      systemAdmin,
    );

    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );
    const value = await configFn("app:config:service-url");
    expect(value).toBe("https://custom.example.com");
  });

  test("tenant Admin cannot set system-scoped value", async () => {
    const error = await stack.http.writeErr(
      ConfigHandlers.set,
      {
        key: "app:config:service-url",
        value: "https://hacked.com",
      },
      tenantAdmin,
    );
    expectErrorIncludes(error, "access_denied");
  });
});

// Settings-Hub round-trip: a human SystemAdmin saves the system-scope keys
// the derived configEdit screen surfaces (privileged boolean + encrypted
// secret), then reads them back. Regression for the checkWriteAccess bug
// that rejected the operator on a `privileged` key with config.errors.systemOnly.
describe("Settings-Hub system-scope write by a human SystemAdmin", () => {
  const sysAccessor = () =>
    createConfigAccessor(stack.registry, resolver, systemAdmin.tenantId, systemAdmin.id, db);

  test("saves a privileged boolean (billing-live) and reads it back", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "integration:config:billing-live", value: true, scope: "system" },
      systemAdmin,
    );
    expect(await sysAccessor()("integration:config:billing-live")).toBe(true);
  });

  test("saves an encrypted system secret (api-key) and reads it back decrypted", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "integration:config:system-secret", value: "sk_live_roundtrip", scope: "system" },
      systemAdmin,
    );
    expect(await sysAccessor()("integration:config:system-secret")).toBe("sk_live_roundtrip");
  });

  // Prod scenario: the value already EXISTS (Stripe screen with stored keys),
  // SystemAdmin clicks Speichern → set.write takes the executor.update path,
  // not create. That path was never covered → version-conflict surfaced only
  // in prod. Three consecutive re-saves catch a stale-version regression.
  test("re-saving an existing plain config key (update path) does not version-conflict", async () => {
    for (const value of [false, true, false]) {
      await stack.http.writeOk(
        ConfigHandlers.set,
        { key: "integration:config:billing-live", value, scope: "system" },
        systemAdmin,
      );
      expect(await sysAccessor()("integration:config:billing-live")).toBe(value);
    }
  });

  test("re-saving an existing secrets-backed key (update path) does not version-conflict", async () => {
    for (const value of ["sk_live_v2", "sk_live_v3"]) {
      await stack.http.writeOk(
        ConfigHandlers.set,
        { key: "integration:config:system-secret", value, scope: "system" },
        systemAdmin,
      );
      expect(await sysAccessor()("integration:config:system-secret")).toBe(value);
    }
  });

  test("save survives a projection/stream version desync (the prod cut-over symptom)", async () => {
    // Reproduces admin.publicstatus.eu: a config value whose read-row version
    // drifted from its event-stream version (migration wrote the row outside
    // the event flow). With optimistic locking this version-conflicts on every
    // save. The handler now skips the lock and appends at the real stream
    // version, so the save succeeds AND the projection resyncs.
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "integration:config:billing-live", value: true, scope: "system" },
      systemAdmin,
    );
    // Corrupt the projection version so it no longer matches the stream.
    await asRawClient(db).unsafe(
      "UPDATE read_config_values SET version = version + 5 WHERE key = 'integration:config:billing-live'",
    );

    // Two consecutive saves: the first proves the lock is bypassed, the second
    // proves the projection actually resynced (a stale version wouldn't drift
    // back into conflict).
    for (const value of [false, true]) {
      await stack.http.writeOk(
        ConfigHandlers.set,
        { key: "integration:config:billing-live", value, scope: "system" },
        systemAdmin,
      );
      expect(await sysAccessor()("integration:config:billing-live")).toBe(value);
    }
  });

  test("a plain tenant Admin is denied the privileged key (not via system-only)", async () => {
    const error = await stack.http.writeErr(
      ConfigHandlers.set,
      { key: "integration:config:billing-live", value: false, scope: "system" },
      tenantAdmin,
    );
    expectErrorIncludes(error, "access_denied");
  });
});

// --- Scenario 2: Mail Server — system default + tenant override ---

describe("scenario 2: tenant-scoped mail server with system fallback", () => {
  test("returns declared default when nothing is set", async () => {
    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );
    const value = await configFn("app:config:mail-server");
    expect(value).toBe("smtp.default.com");
  });

  test("SystemAdmin sets system-level value (acts as global default)", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      {
        key: "app:config:mail-server",
        value: "smtp.company.com",
        scope: "system",
      },
      systemAdmin,
    );

    // Both tenants see the system value
    const configT1 = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      tenantAdmin.id,
      db,
    );
    expect(await configT1("app:config:mail-server")).toBe("smtp.company.com");

    const configT2 = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000002",
      otherTenantAdmin.id,
      db,
    );
    expect(await configT2("app:config:mail-server")).toBe("smtp.company.com");
  });

  test("tenant Admin overrides with tenant-level value", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      {
        key: "app:config:mail-server",
        value: "smtp.tenant1.com",
        scope: "tenant",
      },
      tenantAdmin,
    );

    // Tenant 1 sees override, tenant 2 still sees system value
    const configT1 = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      tenantAdmin.id,
      db,
    );
    expect(await configT1("app:config:mail-server")).toBe("smtp.tenant1.com");

    const configT2 = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000002",
      otherTenantAdmin.id,
      db,
    );
    expect(await configT2("app:config:mail-server")).toBe("smtp.company.com");
  });

  test("reset tenant value falls back to system value", async () => {
    await stack.http.writeOk(
      ConfigHandlers.reset,
      {
        key: "app:config:mail-server",
        scope: "tenant",
      },
      tenantAdmin,
    );

    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      tenantAdmin.id,
      db,
    );
    expect(await configFn("app:config:mail-server")).toBe("smtp.company.com");
  });
});

// --- Scenario 3: Tenant mail signature — Admin can change ---

describe("scenario 3: tenant mail signature", () => {
  test("Admin can set tenant-level signature", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      {
        key: "invoicing:config:mail-signature",
        value: "Mit freundlichen Grüßen, Firma ABC",
      },
      tenantAdmin,
    );

    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      normalUser.id,
      db,
    );
    expect(await configFn("invoicing:config:mail-signature")).toBe(
      "Mit freundlichen Grüßen, Firma ABC",
    );
  });

  test("normal User cannot change signature", async () => {
    const error = await stack.http.writeErr(
      ConfigHandlers.set,
      {
        key: "invoicing:config:mail-signature",
        value: "Hacked signature",
      },
      normalUser,
    );
    expectErrorIncludes(error, "access_denied");
  });
});

// --- Scenario 4: Invoice pattern — Billing can change ---

describe("scenario 4: tenant invoice pattern (Billing role)", () => {
  test("Billing user can set invoice pattern", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      {
        key: "invoicing:config:invoice-pattern",
        value: "RE-{year}/{number}",
      },
      billingUser,
    );

    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      billingUser.id,
      db,
    );
    expect(await configFn("invoicing:config:invoice-pattern")).toBe("RE-{year}/{number}");
  });

  test("Admin cannot change invoice pattern (only Billing)", async () => {
    const error = await stack.http.writeErr(
      ConfigHandlers.set,
      {
        key: "invoicing:config:invoice-pattern",
        value: "ADM-{number}",
      },
      tenantAdmin,
    );
    expectErrorIncludes(error, "access_denied");
  });
});

// --- Scenario 5: User push notification setting ---

describe("scenario 5: user-scoped push notifications", () => {
  test("default is true", async () => {
    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      normalUser.id,
      db,
    );
    expect(await configFn("notifications:config:push-enabled")).toBe(true);
  });

  test("user can disable for themselves", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      {
        key: "notifications:config:push-enabled",
        value: false,
      },
      normalUser,
    );

    // This user sees false
    const configUser = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      normalUser.id,
      db,
    );
    expect(await configUser("notifications:config:push-enabled")).toBe(false);

    // Other user still sees default (true)
    const configOther = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      tenantAdmin.id,
      db,
    );
    expect(await configOther("notifications:config:push-enabled")).toBe(true);
  });

  test("tenant-level default overrides declared default", async () => {
    // Admin sets tenant-level default to false
    await stack.http.writeOk(
      ConfigHandlers.set,
      {
        key: "notifications:config:push-enabled",
        value: false,
        scope: "tenant",
      },
      tenantAdmin,
    );

    // User who hasn't set their own value now sees false (tenant default)
    const configAdmin = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      tenantAdmin.id,
      db,
    );
    expect(await configAdmin("notifications:config:push-enabled")).toBe(false);

    // User who already set their value still sees their value (false)
    const configUser = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      normalUser.id,
      db,
    );
    expect(await configUser("notifications:config:push-enabled")).toBe(false);
  });
});

// --- Scenario 6: Feature setting per tenant ---

describe("scenario 6: feature number setting per tenant", () => {
  test("returns typed number default", async () => {
    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      normalUser.id,
      db,
    );
    const value = await configFn("orders:config:max-order-count");
    expect(value).toBe(100);
    expect(typeof value).toBe("number");
  });

  test("Admin sets number value, code can do > comparison", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      {
        key: "orders:config:max-order-count",
        value: 50,
      },
      tenantAdmin,
    );

    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      normalUser.id,
      db,
    );
    const maxOrders = await configFn("orders:config:max-order-count");

    expect(typeof maxOrders).toBe("number");
    expect((maxOrders as number) > 25).toBe(true);
    expect((maxOrders as number) > 75).toBe(false);
  });

  test("different tenants have different values", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      {
        key: "orders:config:max-order-count",
        value: 200,
      },
      otherTenantAdmin,
    );

    const configT1 = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      normalUser.id,
      db,
    );
    const configT2 = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000002",
      otherTenantAdmin.id,
      db,
    );

    expect(await configT1("orders:config:max-order-count")).toBe(50);
    expect(await configT2("orders:config:max-order-count")).toBe(200);
  });
});

// --- ctx.config() integration ---

describe("ctx.config() in handler context", () => {
  test("handler can read config via ctx.config()", async () => {
    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      tenantAdmin.id,
      db,
    );

    const maxOrders = await configFn("orders:config:max-order-count");
    const currentOrders = 60;

    expect(typeof maxOrders).toBe("number");
    expect(maxOrders).toBe(50);
    expect(currentOrders > (maxOrders as number)).toBe(true);
  });

  test("handle from r.config() carries the qualified key the registry stores", () => {
    expect(ordersFeature.exports.maxOrderCount.name).toBe("orders:config:max-order-count");
    expect(notificationsFeature.exports.pushEnabled.name).toBe("notifications:config:push-enabled");
  });

  test("ctx.config(handle) is wired through the dispatcher into real handlers", async () => {
    // Reset so prior test order doesn't pollute the assertion.
    probe.orders = undefined;
    probe.push = undefined;
    await stack.http.writeOk("probe:write:read-config", {}, tenantAdmin);
    // The probe handler ran ctx.config(handle) for both keys — typeof
    // catches the regression where the handle path silently returns the
    // broad union instead of the narrowed primitive.
    expect(typeof probe.orders).toBe("number");
    expect(typeof probe.push).toBe("boolean");
  });
});

// --- config.values query ---

describe("config.values query handler", () => {
  test("returns all visible config values for user", async () => {
    const values = await stack.http.queryOk<Record<string, { value: unknown; scope: string }>>(
      ConfigQueries.values,
      {},
      tenantAdmin,
    );

    expect(values["app:config:service-url"]).toBeDefined();
    expect(values["app:config:mail-server"]).toBeDefined();
    expect(values["invoicing:config:mail-signature"]).toBeDefined();
    expect(values["notifications:config:push-enabled"]).toBeDefined();
    expect(values["orders:config:max-order-count"]).toBeDefined();
  });

  test("filters by read access", async () => {
    const values = await stack.http.queryOk<Record<string, { value: unknown; scope: string }>>(
      ConfigQueries.values,
      {},
      normalUser,
    );

    // normalUser (role: User) should see "all" read access keys
    expect(values["invoicing:config:mail-signature"]).toBeDefined();
    expect(values["notifications:config:push-enabled"]).toBeDefined();
    expect(values["orders:config:max-order-count"]).toBeDefined();

    // But NOT keys restricted to Admin/SystemAdmin
    expect(values["app:config:service-url"]).toBeUndefined();
    expect(values["app:config:mail-server"]).toBeUndefined();
  });
});

// --- config.schema query ---

describe("config.schema query handler", () => {
  test("returns key definitions filtered by read access", async () => {
    const schema = await stack.http.queryOk<Record<string, unknown>>(
      ConfigQueries.schema,
      {},
      normalUser,
    );

    expect(schema["invoicing:config:mail-signature"]).toBeDefined();
    expect(schema["app:config:service-url"]).toBeUndefined();
  });
});

// --- config.readiness query ---

describe("config.readiness query handler", () => {
  type Missing = { missing: Array<{ key: string; scope: string; type: string }> };

  // Pro Test ein frischer Tenant — die Tests mutieren required-Keys und
  // dürfen sich nicht über Reihenfolge-Kopplung gegenseitig sehen (272/3).
  function readinessAdminFor(n: number) {
    return createTestUser({
      id: 700 + n,
      tenantId: `00000000-0000-4000-8000-0000000007${String(n).padStart(2, "0")}`,
    });
  }

  test("lists required keys without a usable value — and only those", async () => {
    const { missing } = await stack.http.queryOk<Missing>(
      ConfigQueries.readiness,
      {},
      readinessAdminFor(1),
    );

    const keys = missing.map((m) => m.key);
    expect(keys).toContain("transport:config:smtp-host");
    expect(keys).toContain("transport:config:api-url");
    expect(keys).toContain("transport:config:timeout");
    // Non-required keys never show up, configured or not.
    expect(keys).not.toContain("app:config:mail-server");
    expect(keys).not.toContain("orders:config:max-order-count");
  });

  test("whitespace-only text value still counts as missing (requireNonEmpty-Parität)", async () => {
    const admin = readinessAdminFor(2);
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "transport:config:api-url", value: "   " },
      admin,
    );

    const { missing } = await stack.http.queryOk<Missing>(ConfigQueries.readiness, {}, admin);
    expect(missing.map((m) => m.key)).toContain("transport:config:api-url");
  });

  test("a real value clears the key from the missing list", async () => {
    const admin = readinessAdminFor(3);
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "transport:config:api-url", value: "https://api.example.com" },
      admin,
    );
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "transport:config:timeout", value: 30 },
      admin,
    );

    const { missing } = await stack.http.queryOk<Missing>(ConfigQueries.readiness, {}, admin);
    const keys = missing.map((m) => m.key);
    expect(keys).not.toContain("transport:config:api-url");
    expect(keys).not.toContain("transport:config:timeout");
    // Untouched required keys stay missing.
    expect(keys).toContain("transport:config:smtp-host");
  });

  test("filters by read access", async () => {
    const { missing } = await stack.http.queryOk<Missing>(ConfigQueries.readiness, {}, normalUser);

    const keys = missing.map((m) => m.key);
    // read: all (tenant-scope default) → visible to a plain User
    expect(keys).toContain("transport:config:webhook-url");
    // read: admin-only → hidden from a plain User even though unset
    expect(keys).not.toContain("transport:config:smtp-host");
  });

  test("readiness is per-tenant: another tenant still sees the keys as missing", async () => {
    const { missing } = await stack.http.queryOk<Missing>(
      ConfigQueries.readiness,
      {},
      otherTenantAdmin,
    );

    const keys = missing.map((m) => m.key);
    expect(keys).toContain("transport:config:api-url");
    expect(keys).toContain("transport:config:timeout");
  });

  test("schema query exposes the required flag for UI rendering", async () => {
    const schema = await stack.http.queryOk<Record<string, { required?: boolean }>>(
      ConfigQueries.schema,
      {},
      tenantAdmin,
    );
    expect(schema["transport:config:smtp-host"]?.required).toBe(true);
    expect(schema["app:config:mail-server"]?.required).toBeUndefined();
  });
});

// --- Type validation ---

describe("type validation", () => {
  test("rejects string for number key", async () => {
    const error = await stack.http.writeErr(
      ConfigHandlers.set,
      {
        key: "orders:config:max-order-count",
        value: "not a number",
      },
      tenantAdmin,
    );
    expectErrorIncludes(error, "invalid_type");
  });

  test("rejects number for boolean key", async () => {
    const error = await stack.http.writeErr(
      ConfigHandlers.set,
      {
        key: "notifications:config:push-enabled",
        value: 42,
      },
      normalUser,
    );
    expectErrorIncludes(error, "invalid_type");
  });

  test("rejects unknown config key", async () => {
    const error = await stack.http.writeErr(
      ConfigHandlers.set,
      {
        key: "nonexistent:config:key",
        value: "test",
      },
      systemAdmin,
    );
    // unknown config key maps to NotFoundError — reason includes the snake entity name
    expectErrorIncludes(error, "config_key_not_found");
  });
});

// --- Encrypted config ---

describe("encrypted config", () => {
  test("encrypted value is stored encrypted in DB, read back decrypted", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      {
        key: "integration:config:api-secret",
        value: "sk-super-secret-key-12345",
      },
      systemAdmin,
    );

    // Read via config accessor — should be decrypted
    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      systemAdmin.id,
      db,
    );
    const value = await configFn("integration:config:api-secret");
    expect(value).toBe("sk-super-secret-key-12345");

    // Verify raw DB value is NOT plaintext
    const [raw] = await selectMany(db, configValuesTable, { key: "integration:config:api-secret" });
    const rawValue = raw?.value as string;
    expect(rawValue).not.toBe("sk-super-secret-key-12345");
    expect(rawValue).not.toContain("sk-super-secret");
  });

  test("non-SystemAdmin cannot read encrypted key", async () => {
    const values = await stack.http.queryOk<Record<string, unknown>>(
      ConfigQueries.values,
      {},
      tenantAdmin,
    );
    expect(values["integration:config:api-secret"]).toBeUndefined();
  });

  test("config.values returns masked value for encrypted key even with read access", async () => {
    const values = await stack.http.queryOk<Record<string, { value: unknown; scope: string }>>(
      ConfigQueries.values,
      {},
      systemAdmin,
    );
    expect(values["integration:config:api-secret"]).toBeDefined();
    expect(values["integration:config:api-secret"]?.value).toBe("••••••");
  });

  test("ctx.config() returns decrypted value", async () => {
    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      systemAdmin.id,
      db,
    );
    const value = await configFn("integration:config:api-secret");
    expect(value).toBe("sk-super-secret-key-12345");
  });
});

// --- Config lifecycle events ---
//
// Post-ES refactor: each (key, scope) pair is its own aggregate stream with
// auto-lifecycle events `configValue.created / .updated / .deleted`. The
// pre-ES flat "config:event:config-changed" stream on a per-tenant
// aggregate is gone — subscribers listen to the auto-events via
// r.multiStreamProjection instead, and per-key replay/asOf falls out of the
// per-value stream granularity.

describe("configValue lifecycle events", () => {
  test("set emits configValue.updated carrying the serialized new value", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "orders:config:max-order-count", value: 250 },
      tenantAdmin,
    );
    const events = await selectMany(db, eventsTable, { aggregateType: "config-value" });
    // The first set in the suite created the row; subsequent sets update it.
    // Look at the most recent update carrying our value to verify the
    // serialized JSON lands in the event payload (key stays on the row,
    // only value moves on updates — the executor emits a changes/previous
    // diff).
    const updates = events.filter(
      (e) =>
        e.type === "config-value.updated" &&
        (e.payload as { previous?: { key?: string } })?.previous?.key ===
          "orders:config:max-order-count",
    );
    expect(updates.length).toBeGreaterThanOrEqual(1);
    const last = updates[updates.length - 1];
    expect((last?.payload as { changes?: { value?: string } })?.changes?.value).toBe(
      JSON.stringify(250),
    );
  });

  test("reset emits configValue.deleted for the value row", async () => {
    // Set first so reset has something to roll back.
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "invoicing:config:mail-signature", value: "Cheers" },
      tenantAdmin,
    );
    await stack.http.writeOk(
      ConfigHandlers.reset,
      { key: "invoicing:config:mail-signature" },
      tenantAdmin,
    );
    const events = await selectMany(db, eventsTable, { aggregateType: "config-value" });
    const deletes = events.filter(
      (e) =>
        e.type === "config-value.deleted" &&
        (e.payload as { previous?: { key?: string } })?.previous?.key ===
          "invoicing:config:mail-signature",
    );
    expect(deletes.length).toBeGreaterThanOrEqual(1);
  });

  test("first set on a fresh key emits configValue.created with key + serialized value", async () => {
    // Uses a dedicated key (integration:config:lifecycle-probe) that no
    // earlier scenario touches — guarantees the FIRST event is a .created,
    // not a .updated, so the assertion reaches the create-path of the
    // executor without depending on test execution order.
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "integration:config:lifecycle-probe", value: "alpha" },
      tenantAdmin,
    );
    const events = await selectMany(db, eventsTable, { aggregateType: "config-value" });
    const created = events.filter(
      (e) =>
        e.type === "config-value.created" &&
        (e.payload as { key?: string })?.key === "integration:config:lifecycle-probe",
    );
    expect(created.length).toBe(1);
    expect(created[0]?.payload).toMatchObject({
      key: "integration:config:lifecycle-probe",
      value: JSON.stringify("alpha"),
    });
  });

  test("subsequent set emits configValue.updated carrying both changes and previous", async () => {
    // Change the value we seeded above to exercise the .updated-event
    // shape: the executor stamps BOTH halves of the diff onto the payload
    // (changes = what the user sent, previous = the pre-update row). MSPs
    // reading across aggregates need `previous` to decrement / undo when
    // a parent-FK moves — dropping it would break replays.
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "integration:config:lifecycle-probe", value: "beta" },
      tenantAdmin,
    );
    const events = await selectMany(db, eventsTable, { aggregateType: "config-value" });
    const updates = events.filter(
      (e) =>
        e.type === "config-value.updated" &&
        (e.payload as { previous?: { key?: string } })?.previous?.key ===
          "integration:config:lifecycle-probe",
    );
    expect(updates.length).toBeGreaterThanOrEqual(1);
    const last = updates[updates.length - 1];
    const payload = last?.payload as {
      changes?: { value?: string };
      previous?: { value?: string; key?: string };
    };
    expect(payload.changes?.value).toBe(JSON.stringify("beta"));
    expect(payload.previous?.value).toBe(JSON.stringify("alpha"));
    expect(payload.previous?.key).toBe("integration:config:lifecycle-probe");
  });

  test("encrypted-key plaintext never appears in the event payload", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "integration:config:api-secret", value: "rotated-secret-987" },
      systemAdmin,
    );
    const events = await selectMany(db, eventsTable, { aggregateType: "config-value" });
    const created = events.filter(
      (e) =>
        e.type === "config-value.created" &&
        (e.payload as { key?: string })?.key === "integration:config:api-secret",
    );
    expect(created.length).toBeGreaterThanOrEqual(1);
    const last = created[created.length - 1];
    // The serialized ciphertext (not plaintext) is what landed in the
    // payload — the resolver wraps set() in the encryption provider before
    // the executor hands flatData to the event writer.
    const serializedPayload = JSON.stringify(last?.payload);
    expect(serializedPayload).not.toContain("rotated-secret-987");
  });
});

// --- Scenario 7: Bounds enforcement on numeric keys ---
//
// orders:config:max-upload-size-mb declares bounds: { min: 1, max: 1000 }.
// A tenant-admin SET with a value outside that range must hard-reject with
// a validation error — silent clamping is explicitly ruled out (see
// types/config.ts comment on ConfigBounds).

describe("scenario 7: bounds enforcement", () => {
  const boundedKey = "orders:config:max-upload-size-mb";

  test("accepts value inside bounds", async () => {
    const result = await stack.http.writeOk(
      ConfigHandlers.set,
      { key: boundedKey, value: 500 },
      tenantAdmin,
    );
    expect(result).toMatchObject({ value: 500 });
  });

  test("accepts boundary values (min + max exact)", async () => {
    const atMin = await stack.http.writeOk(
      ConfigHandlers.set,
      { key: boundedKey, value: 1 },
      tenantAdmin,
    );
    expect(atMin).toMatchObject({ value: 1 });
    const atMax = await stack.http.writeOk(
      ConfigHandlers.set,
      { key: boundedKey, value: 1000 },
      tenantAdmin,
    );
    expect(atMax).toMatchObject({ value: 1000 });
  });

  test("rejects value below min with out_of_bounds", async () => {
    const error = await stack.http.writeErr(
      ConfigHandlers.set,
      { key: boundedKey, value: 0 },
      tenantAdmin,
    );
    expectErrorIncludes(error, "out_of_bounds");
  });

  test("rejects value above max with out_of_bounds", async () => {
    const error = await stack.http.writeErr(
      ConfigHandlers.set,
      { key: boundedKey, value: 10_000 },
      tenantAdmin,
    );
    expectErrorIncludes(error, "out_of_bounds");
  });

  test("rejects even when caller has write-role — bounds override role-grants", async () => {
    // tenantAdmin has Admin role → passes access check, then fails bounds.
    const error = await stack.http.writeErr(
      ConfigHandlers.set,
      { key: boundedKey, value: -1 },
      tenantAdmin,
    );
    expectErrorIncludes(error, "out_of_bounds");
  });
});

// --- Scenario 8: App-Boot-Overrides ---
//
// buildServer-level overrides sit between the scope-specific rows and the
// feature-declared default. Key rule: a deliberate Set from a tenant-admin
// still wins. The override is the *better default for this deploy*, not a
// hard policy.

describe("scenario 8: app-boot overrides", () => {
  const OVERRIDE_KEY = "orders:config:max-order-count";

  test("validateAppOverrides throws synchronously for bad values (prevents broken deploy)", () => {
    expect(() =>
      validateAppOverrides(stack.registry, {
        "orders:config:max-upload-size-mb": 99_999, // above bounds.max = 1000
      }),
    ).toThrow(/above bounds\.max/i);

    expect(() =>
      validateAppOverrides(stack.registry, {
        "does-not-exist:config:foo": 1,
      }),
    ).toThrow(/unknown config key/i);
  });

  test("override is returned when no row exists for the key", async () => {
    // Fresh tenant-id that earlier tests haven't touched — so the cascade
    // finds no tenant-row, no system-row, and falls through to the override.
    const freshTenant = "00000000-0000-4000-8000-0000000000aa";
    const resolverWithOverride = createConfigResolver({
      appOverrides: validateAppOverrides(stack.registry, {
        [OVERRIDE_KEY]: 250,
      }),
    });

    const keyDef = stack.registry.getConfigKey(OVERRIDE_KEY);
    if (!keyDef) throw new Error("key missing");
    const value = await resolverWithOverride.get(
      OVERRIDE_KEY,
      keyDef,
      // biome-ignore lint/suspicious/noExplicitAny: throwaway TenantId brand
      freshTenant as any,
      "00000000-0000-4000-8000-0000000000aa",
      db,
    );
    expect(value).toBe(250);
  });

  test("tenant-row wins over app-boot-override (admin intent > deploy default)", async () => {
    // Set a tenant-row first.
    await stack.http.writeOk(ConfigHandlers.set, { key: OVERRIDE_KEY, value: 77 }, tenantAdmin);

    // Now build a resolver with a different override value.
    const resolverWithOverride = createConfigResolver({
      appOverrides: validateAppOverrides(stack.registry, {
        [OVERRIDE_KEY]: 250,
      }),
    });

    const keyDef = stack.registry.getConfigKey(OVERRIDE_KEY);
    if (!keyDef) throw new Error("key missing");
    const value = await resolverWithOverride.get(
      OVERRIDE_KEY,
      keyDef,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );
    // Row wins: 77, not 250.
    expect(value).toBe(77);
  });

  test("falls back to feature-declared default when no row AND no override", async () => {
    const resolverNoOverride = createConfigResolver();
    // Use a fresh tenant id so no tenant-row interferes.
    const freshTenant = "00000000-0000-4000-8000-000000000999";
    const keyDef = stack.registry.getConfigKey(OVERRIDE_KEY);
    if (!keyDef) throw new Error("key missing");
    const value = await resolverNoOverride.get(
      OVERRIDE_KEY,
      keyDef,
      // biome-ignore lint/suspicious/noExplicitAny: TenantId brand for a throwaway test value
      freshTenant as any,
      "00000000-0000-4000-8000-000000000999",
      db,
    );
    expect(value).toBe(100); // keyDef.default
  });
});

// --- Scenario 9: Computed resolver (plan-based values) ---
//
// `computed` sits between app-override and default in the cascade. Row
// still wins — a tenant-admin SET beats the plan. This matches the
// documented "admin intent > deploy default > plan default > hard default"
// hierarchy from configuration-layers.md.

describe("scenario 9: computed resolver", () => {
  const COMPUTED_KEY = "orders:config:plan-based-quota-gb";

  test("computed returns Pro-plan value for Tenant 2 (endsWith 0002)", async () => {
    const keyDef = stack.registry.getConfigKey(COMPUTED_KEY);
    if (!keyDef) throw new Error("key missing");
    const value = await resolver.get(
      COMPUTED_KEY,
      keyDef,
      otherTenantAdmin.tenantId, // ends in 0002 → Pro
      otherTenantAdmin.id,
      db,
    );
    expect(value).toBe(500);
  });

  test("computed returns basic-plan value for Tenant 1 (no Pro suffix)", async () => {
    const keyDef = stack.registry.getConfigKey(COMPUTED_KEY);
    if (!keyDef) throw new Error("key missing");
    // Tenant admin's tenantId doesn't end in 0002 — gets basic.
    const value = await resolver.get(
      COMPUTED_KEY,
      keyDef,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );
    expect(value).toBe(50);
  });

  test("row wins over computed — admin SET beats plan-default", async () => {
    // Tenant admin manually sets a value.
    await stack.http.writeOk(ConfigHandlers.set, { key: COMPUTED_KEY, value: 999 }, tenantAdmin);

    const keyDef = stack.registry.getConfigKey(COMPUTED_KEY);
    if (!keyDef) throw new Error("key missing");
    const value = await resolver.get(
      COMPUTED_KEY,
      keyDef,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );
    // computed would return 50, row says 999 → row wins.
    expect(value).toBe(999);
  });

  test("app-override on a computed key is rejected at validation time", async () => {
    // Post Task-17: combining computed with an app-override silently bypasses
    // the plan-logic. validateAppOverrides refuses at boot. This test pins
    // that guarantee — a future relaxation would need to update it explicitly.
    expect(() =>
      validateAppOverrides(stack.registry, {
        [COMPUTED_KEY]: 77,
      }),
    ).toThrow(/computed resolver.*app-overrides would silently bypass/i);
  });
});

// --- Scenario 10: getWithSource — Debug/Ops-Introspection ---
//
// Same cascade as get() but also reports WHICH layer produced the value.
// Ops-tooling needs this for "warum ist mein Wert X?" — debugging a
// cascade with 6 possible sources by hand is no fun.

describe("scenario 10: getWithSource reports source-of-truth", () => {
  const TENANT_KEY = "orders:config:max-order-count"; // default: 100, scope: tenant

  test("source=tenant-row when a tenant-row exists", async () => {
    await stack.http.writeOk(ConfigHandlers.set, { key: TENANT_KEY, value: 77 }, tenantAdmin);
    const keyDef = stack.registry.getConfigKey(TENANT_KEY);
    if (!keyDef) throw new Error("key missing");
    const traced = await resolver.getWithSource(
      TENANT_KEY,
      keyDef,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );
    expect(traced.value).toBe(77);
    expect(traced.source).toBe("tenant-row");
  });

  test("source=default when no row, no override, no computed", async () => {
    // Fresh tenant with no row for this key → falls through to keyDef.default.
    const freshTenant = "00000000-0000-4000-8000-0000000000dd";
    const keyDef = stack.registry.getConfigKey(TENANT_KEY);
    if (!keyDef) throw new Error("key missing");
    const traced = await resolver.getWithSource(
      TENANT_KEY,
      keyDef,
      // biome-ignore lint/suspicious/noExplicitAny: throwaway TenantId brand
      freshTenant as any,
      "00000000-0000-4000-8000-0000000000dd",
      db,
    );
    expect(traced.value).toBe(100); // keyDef.default
    expect(traced.source).toBe("default");
  });

  test("source=app-override when appOverrides has the key and no row exists", async () => {
    const resolverWithOverride = createConfigResolver({
      appOverrides: validateAppOverrides(stack.registry, { [TENANT_KEY]: 333 }),
    });
    const freshTenant = "00000000-0000-4000-8000-0000000000ee";
    const keyDef = stack.registry.getConfigKey(TENANT_KEY);
    if (!keyDef) throw new Error("key missing");
    const traced = await resolverWithOverride.getWithSource(
      TENANT_KEY,
      keyDef,
      // biome-ignore lint/suspicious/noExplicitAny: throwaway TenantId brand
      freshTenant as any,
      "00000000-0000-4000-8000-0000000000ee",
      db,
    );
    expect(traced.value).toBe(333);
    expect(traced.source).toBe("app-override");
  });

  test("source=computed when no row AND no override AND keyDef.computed exists", async () => {
    const freshTenant = "00000000-0000-4000-8000-0000000000ff";
    const keyDef = stack.registry.getConfigKey("orders:config:plan-based-quota-gb");
    if (!keyDef) throw new Error("key missing");
    const traced = await resolver.getWithSource(
      "orders:config:plan-based-quota-gb",
      keyDef,
      // biome-ignore lint/suspicious/noExplicitAny: throwaway TenantId brand
      freshTenant as any,
      "00000000-0000-4000-8000-0000000000ff",
      db,
    );
    expect(traced.source).toBe("computed");
    expect(traced.value).toBe(50); // basic plan
  });

  test("source=missing when no row, no override, no computed, no default", async () => {
    // Key with no default + no row + no override.
    const noDefaultKey = createTenantConfig("number");
    const freshTenant = "00000000-0000-4000-8000-000000000011";
    const traced = await resolver.getWithSource(
      "throwaway:config:no-default",
      noDefaultKey,
      // biome-ignore lint/suspicious/noExplicitAny: throwaway TenantId brand
      freshTenant as any,
      "00000000-0000-4000-8000-000000000011",
      db,
    );
    expect(traced.value).toBeUndefined();
    expect(traced.source).toBe("missing");
  });

  test("get() and getWithSource() return equivalent values for the same cascade", async () => {
    const keyDef = stack.registry.getConfigKey(TENANT_KEY);
    if (!keyDef) throw new Error("key missing");
    const flat = await resolver.get(TENANT_KEY, keyDef, tenantAdmin.tenantId, tenantAdmin.id, db);
    const traced = await resolver.getWithSource(
      TENANT_KEY,
      keyDef,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );
    expect(traced.value).toBe(flat);
  });
});

// --- Scenario 11: Config Seeding ---
//
// Seeds are deploy-time defaults written as system-rows via the event-store
// executor. They sit at cascade level 4 (system-row) — above app-override
// and default but below any explicit user/tenant row.

describe("scenario 11: config seeding", () => {
  const SEED_THEME = "seeddemo:config:theme-color";
  const SEED_MAINT = "seeddemo:config:maintenance-mode";
  const T1 = "00000000-0000-4000-8000-0000000000aa" as TenantId;
  const T2 = "00000000-0000-4000-8000-0000000000bb" as TenantId;
  const T3 = "00000000-0000-4000-8000-0000000000cc" as TenantId;

  beforeAll(async () => {
    const seedDefs = stack.registry
      .getAllConfigSeeds()
      .filter((s) => s.key.startsWith("seeddemo:"));
    await seedConfigValues(seedDefs, configValuesTable, configValueEntity, stack.registry, db);
  });

  test("returns seed value when no row exists", async () => {
    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      T1,
      "00000000-0000-4000-8000-0000000000aa",
      db,
    );
    expect(await configFn(SEED_THEME)).toBe("dark");
  });

  test("system-scope seed produces system-row in cascade", async () => {
    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      T1,
      "00000000-0000-4000-8000-0000000000aa",
      db,
    );
    expect(await configFn(SEED_MAINT)).toBe(true);
  });

  test("getWithSource reports source=system-row for seeded values", async () => {
    const keyDef = stack.registry.getConfigKey(SEED_THEME);
    if (!keyDef) throw new Error("key missing");
    const traced = await resolver.getWithSource(
      SEED_THEME,
      keyDef,
      T2,
      "00000000-0000-4000-8000-0000000000bb",
      db,
    );
    expect(traced.value).toBe("dark");
    expect(traced.source).toBe("system-row");
  });

  test("seed + app-override: seed wins (system-row > app-override)", async () => {
    const resolverWithOverride = createConfigResolver({
      appOverrides: validateAppOverrides(stack.registry, { [SEED_THEME]: "pink" }),
    });
    const configFn = createConfigAccessor(
      stack.registry,
      resolverWithOverride,
      T3,
      "00000000-0000-4000-8000-0000000000cc",
      db,
    );
    expect(await configFn(SEED_THEME)).toBe("dark");
  });

  test("admin override beats seed (tenant-row > system-row)", async () => {
    await stack.http.writeOk(ConfigHandlers.set, { key: SEED_THEME, value: "red" }, tenantAdmin);
    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );
    expect(await configFn(SEED_THEME)).toBe("red");
  });
});

// --- Pattern validation (text keys) ---

describe("pattern validation", () => {
  const HEX_KEY = "patterned:config:hex-color";
  const admin = createTestUser({ id: 99, roles: ["Admin"] });

  test("valid value passes the regex", async () => {
    const res = await stack.http.writeOk<{ value: string }>(
      "config:write:set",
      { key: HEX_KEY, value: "#abc123" },
      admin,
    );
    expect(res).toMatchObject({ value: "#abc123" });
  });

  test("empty value passes (allow-empty branch)", async () => {
    const res = await stack.http.writeOk<{ value: string }>(
      "config:write:set",
      { key: HEX_KEY, value: "" },
      admin,
    );
    expect(res).toMatchObject({ value: "" });
  });

  test("non-matching value is hard-rejected with invalid_format", async () => {
    const error = await stack.http.writeErr(
      "config:write:set",
      { key: HEX_KEY, value: "tomato" },
      admin,
    );
    expectErrorIncludes(error, "invalid_format");
  });

  test("style-breakout attempt is rejected (no CSS injection survives)", async () => {
    const error = await stack.http.writeErr(
      "config:write:set",
      { key: HEX_KEY, value: "#fff;}</style><script>" },
      admin,
    );
    expectErrorIncludes(error, "invalid_format");
  });
});

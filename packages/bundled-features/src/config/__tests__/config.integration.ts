import { randomBytes } from "node:crypto";
import { createEncryptionProvider, type DbConnection } from "@kumiko/framework/db";
import {
  access,
  createSystemConfig,
  createTenantConfig,
  createUserConfig,
  defineFeature,
} from "@kumiko/framework/engine";
import { eventsTable } from "@kumiko/framework/event-store";
import {
  createTestUser,
  expectErrorIncludes,
  pushTables,
  setupTestStack,
  type TestStack,
  TestUsers,
} from "@kumiko/framework/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import {
  createConfigAccessor,
  createConfigAccessorFactory,
  createConfigFeature,
} from "../config-feature";
import { ConfigHandlers, ConfigQueries } from "../constants";
import { type ConfigResolver, createConfigResolver, validateAppOverrides } from "../resolver";
import { configValuesTable } from "../table";

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
    },
  });
});

const configFeature = createConfigFeature();
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
    ],
    // Wire `ctx.config()` for real handlers: pass the resolver-bound factory
    // so the dispatcher can mint a per-user accessor inside buildHandlerContext.
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  db = stack.db.db;

  await pushTables(db, { configValuesTable });
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
    const { eq } = await import("drizzle-orm");
    const [raw] = await db
      .select({ value: configValuesTable.value })
      .from(configValuesTable)
      .where(eq(configValuesTable.key, "integration:config:api-secret"));
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

// --- Config Change-Events ---
//
// set/reset emit "config:event:config-changed" so subscribers (SSE-broadcast,
// cache eviction, audit-export) can react via r.multiStreamProjection. Each
// key gets its own aggregate stream so per-key replay/asOf works.

describe("config-changed domain event", () => {
  test("set emits a config-changed event carrying key+scope+action+value", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "orders:config:max-order-count", value: 250 },
      tenantAdmin,
    );
    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.aggregateType, "configChanges"));
    const setEvents = events.filter(
      (e) =>
        e.type === "config:event:config-changed" &&
        (e.payload as { key?: string; action?: string })?.key === "orders:config:max-order-count" &&
        (e.payload as { action?: string })?.action === "set",
    );
    expect(setEvents.length).toBeGreaterThanOrEqual(1);
    const last = setEvents[setEvents.length - 1];
    expect(last?.aggregateType).toBe("configChanges");
    expect(last?.aggregateId).toBe(tenantAdmin.tenantId);
    expect(last?.payload).toMatchObject({
      key: "orders:config:max-order-count",
      scope: "tenant",
      action: "set",
      value: 250,
    });
  });

  test("reset emits action='reset' with NO value", async () => {
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
    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.aggregateType, "configChanges"));
    const resets = events.filter(
      (e) =>
        (e.payload as { key?: string })?.key === "invoicing:config:mail-signature" &&
        (e.payload as { action?: string })?.action === "reset",
    );
    expect(resets.length).toBeGreaterThanOrEqual(1);
    const last = resets[resets.length - 1];
    expect(last?.payload).toMatchObject({
      key: "invoicing:config:mail-signature",
      scope: "tenant",
      action: "reset",
    });
    expect((last?.payload as { value?: unknown })?.value).toBeUndefined();
  });

  test("encrypted-key value is stripped from the event payload (no secret leak)", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "integration:config:api-secret", value: "rotated-secret-987" },
      systemAdmin,
    );
    const events = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.aggregateType, "configChanges"));
    const setEvents = events.filter(
      (e) =>
        (e.payload as { key?: string })?.key === "integration:config:api-secret" &&
        (e.payload as { action?: string })?.action === "set",
    );
    expect(setEvents.length).toBeGreaterThanOrEqual(1);
    const last = setEvents[setEvents.length - 1];
    // key + scope + action present; value MUST be absent for encrypted keys.
    expect(last?.payload).toMatchObject({
      key: "integration:config:api-secret",
      action: "set",
    });
    expect((last?.payload as { value?: unknown })?.value).toBeUndefined();
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

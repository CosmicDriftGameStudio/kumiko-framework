import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { DbConnection } from "../../db/connection";
import { createEncryptionProvider } from "../../db/encryption";
import { createRegistry, defineFeature, type PipelineUser, type Registry } from "../../engine";
import { createTestDb, createTestTable, type TestDb } from "../../testing";
import { createConfigAccessor, createConfigFeature } from "../config-feature";
import { type ConfigResolver, createConfigResolver } from "../resolver";
import { CONFIG_TABLE_SQL } from "../table";

// --- Setup ---

let testDb: TestDb;
let db: DbConnection;
let registry: Registry;
let resolver: ConfigResolver;

const systemAdmin: PipelineUser = { id: 1, tenantId: 1, roles: ["SystemAdmin"] };
const tenantAdmin: PipelineUser = { id: 2, tenantId: 1, roles: ["Admin"] };
const billingUser: PipelineUser = { id: 3, tenantId: 1, roles: ["Billing"] };
const normalUser: PipelineUser = { id: 4, tenantId: 1, roles: ["User"] };
const otherTenantAdmin: PipelineUser = { id: 5, tenantId: 2, roles: ["Admin"] };

// --- Features that register config keys (based on 6 real scenarios) ---

// Scenario 1: System URL — one value for the whole system
// Scenario 2: Mail server — system default + tenant override
const appFeature = defineFeature("app", (r) => {
  r.requires("config");

  r.config({
    keys: {
      // Scenario 1: system-only URL
      serviceUrl: {
        type: "text",
        default: "https://default.example.com",
        scope: "system",
        access: { write: ["SystemAdmin"], read: ["Admin", "SystemAdmin"] },
      },
      // Scenario 2: mail server with system default + tenant override
      mailServer: {
        type: "text",
        default: "smtp.default.com",
        scope: "tenant",
        access: { write: ["SystemAdmin", "Admin"], read: ["Admin", "SystemAdmin"] },
      },
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
      mailSignature: {
        type: "text",
        default: "Best regards",
        scope: "tenant",
        access: { write: ["Admin"], read: ["all"] },
      },
      // Scenario 4
      invoicePattern: {
        type: "text",
        default: "INV-{year}-{number}",
        scope: "tenant",
        access: { write: ["Billing"], read: ["Admin", "Billing"] },
      },
    },
  });
});

// Scenario 5: User push notification setting
const notificationsFeature = defineFeature("notifications", (r) => {
  r.requires("config");

  r.config({
    keys: {
      pushEnabled: {
        type: "boolean",
        default: true,
        scope: "user",
        access: { write: ["all"], read: ["all"] },
      },
    },
  });
});

// Scenario 6: Feature setting per tenant
const ordersFeature = defineFeature("orders", (r) => {
  r.requires("config");

  r.config({
    keys: {
      maxOrderCount: {
        type: "number",
        default: 100,
        scope: "tenant",
        access: { write: ["Admin"], read: ["all"] },
      },
    },
  });
});

// Encrypted config key
const integrationFeature = defineFeature("integration", (r) => {
  r.requires("config");

  r.config({
    keys: {
      apiSecret: {
        type: "text",
        scope: "tenant",
        encrypted: true,
        access: { write: ["SystemAdmin"], read: ["SystemAdmin"] },
      },
    },
  });
});

const configFeature = createConfigFeature();
const testEncryptionKey = randomBytes(32).toString("base64");

beforeAll(async () => {
  testDb = await createTestDb();
  db = testDb.db;
  await createTestTable(db, CONFIG_TABLE_SQL);

  registry = createRegistry([
    configFeature,
    appFeature,
    invoicingFeature,
    notificationsFeature,
    ordersFeature,
    integrationFeature,
  ]);

  const encryption = createEncryptionProvider(testEncryptionKey);
  resolver = createConfigResolver({ encryption });
});

afterAll(async () => {
  await testDb.cleanup();
});

// Helper to call write handlers
async function callWrite(
  handlerName: string,
  payload: Record<string, unknown>,
  user: PipelineUser,
) {
  const handler = registry.getWriteHandler(handlerName);
  if (!handler) throw new Error(`Handler "${handlerName}" not found`);
  const parsed = handler.schema.parse(payload);
  return handler.handler(
    { type: handlerName, payload: parsed, user },
    { db, registry, configResolver: resolver },
  );
}

// Helper to call query handlers
async function callQuery(
  handlerName: string,
  payload: Record<string, unknown>,
  user: PipelineUser,
) {
  const handler = registry.getQueryHandler(handlerName);
  if (!handler) throw new Error(`Handler "${handlerName}" not found`);
  const parsed = handler.schema.parse(payload);
  return handler.handler(
    { type: handlerName, payload: parsed, user },
    { db, registry, configResolver: resolver },
  );
}

// --- Scenario 1: System URL — einmal pro System ---

describe("scenario 1: system-scoped service URL", () => {
  test("returns default when no value is set", async () => {
    const configFn = createConfigAccessor(
      registry,
      resolver,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );
    const value = await configFn("app.serviceUrl");
    expect(value).toBe("https://default.example.com");
  });

  test("SystemAdmin can set system-scoped value", async () => {
    const result = await callWrite(
      "config.set",
      {
        key: "app.serviceUrl",
        value: "https://custom.example.com",
      },
      systemAdmin,
    );
    expect(result.isSuccess).toBe(true);

    const configFn = createConfigAccessor(
      registry,
      resolver,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );
    const value = await configFn("app.serviceUrl");
    expect(value).toBe("https://custom.example.com");
  });

  test("tenant Admin cannot set system-scoped value", async () => {
    const result = await callWrite(
      "config.set",
      {
        key: "app.serviceUrl",
        value: "https://hacked.com",
      },
      tenantAdmin,
    );
    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) expect(result.error).toContain("access_denied");
  });
});

// --- Scenario 2: Mail Server — system default + tenant override ---

describe("scenario 2: tenant-scoped mail server with system fallback", () => {
  test("returns declared default when nothing is set", async () => {
    const configFn = createConfigAccessor(
      registry,
      resolver,
      tenantAdmin.tenantId,
      tenantAdmin.id,
      db,
    );
    const value = await configFn("app.mailServer");
    expect(value).toBe("smtp.default.com");
  });

  test("SystemAdmin sets system-level value (acts as global default)", async () => {
    const result = await callWrite(
      "config.set",
      {
        key: "app.mailServer",
        value: "smtp.company.com",
        scope: "system",
      },
      systemAdmin,
    );
    expect(result.isSuccess).toBe(true);

    // Both tenants see the system value
    const configT1 = createConfigAccessor(registry, resolver, 1, tenantAdmin.id, db);
    expect(await configT1("app.mailServer")).toBe("smtp.company.com");

    const configT2 = createConfigAccessor(registry, resolver, 2, otherTenantAdmin.id, db);
    expect(await configT2("app.mailServer")).toBe("smtp.company.com");
  });

  test("tenant Admin overrides with tenant-level value", async () => {
    const result = await callWrite(
      "config.set",
      {
        key: "app.mailServer",
        value: "smtp.tenant1.com",
        scope: "tenant",
      },
      tenantAdmin,
    );
    expect(result.isSuccess).toBe(true);

    // Tenant 1 sees override, tenant 2 still sees system value
    const configT1 = createConfigAccessor(registry, resolver, 1, tenantAdmin.id, db);
    expect(await configT1("app.mailServer")).toBe("smtp.tenant1.com");

    const configT2 = createConfigAccessor(registry, resolver, 2, otherTenantAdmin.id, db);
    expect(await configT2("app.mailServer")).toBe("smtp.company.com");
  });

  test("reset tenant value falls back to system value", async () => {
    const result = await callWrite(
      "config.reset",
      {
        key: "app.mailServer",
        scope: "tenant",
      },
      tenantAdmin,
    );
    expect(result.isSuccess).toBe(true);

    const configFn = createConfigAccessor(registry, resolver, 1, tenantAdmin.id, db);
    expect(await configFn("app.mailServer")).toBe("smtp.company.com");
  });
});

// --- Scenario 3: Tenant mail signature — Admin can change ---

describe("scenario 3: tenant mail signature", () => {
  test("Admin can set tenant-level signature", async () => {
    const result = await callWrite(
      "config.set",
      {
        key: "invoicing.mailSignature",
        value: "Mit freundlichen Grüßen, Firma ABC",
      },
      tenantAdmin,
    );
    expect(result.isSuccess).toBe(true);

    const configFn = createConfigAccessor(registry, resolver, 1, normalUser.id, db);
    expect(await configFn("invoicing.mailSignature")).toBe("Mit freundlichen Grüßen, Firma ABC");
  });

  test("normal User cannot change signature", async () => {
    const result = await callWrite(
      "config.set",
      {
        key: "invoicing.mailSignature",
        value: "Hacked signature",
      },
      normalUser,
    );
    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) expect(result.error).toContain("access_denied");
  });
});

// --- Scenario 4: Invoice pattern — Billing can change ---

describe("scenario 4: tenant invoice pattern (Billing role)", () => {
  test("Billing user can set invoice pattern", async () => {
    const result = await callWrite(
      "config.set",
      {
        key: "invoicing.invoicePattern",
        value: "RE-{year}/{number}",
      },
      billingUser,
    );
    expect(result.isSuccess).toBe(true);

    const configFn = createConfigAccessor(registry, resolver, 1, billingUser.id, db);
    expect(await configFn("invoicing.invoicePattern")).toBe("RE-{year}/{number}");
  });

  test("Admin cannot change invoice pattern (only Billing)", async () => {
    const result = await callWrite(
      "config.set",
      {
        key: "invoicing.invoicePattern",
        value: "ADM-{number}",
      },
      tenantAdmin,
    );
    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) expect(result.error).toContain("access_denied");
  });
});

// --- Scenario 5: User push notification setting ---

describe("scenario 5: user-scoped push notifications", () => {
  test("default is true", async () => {
    const configFn = createConfigAccessor(registry, resolver, 1, normalUser.id, db);
    expect(await configFn("notifications.pushEnabled")).toBe(true);
  });

  test("user can disable for themselves", async () => {
    const result = await callWrite(
      "config.set",
      {
        key: "notifications.pushEnabled",
        value: false,
      },
      normalUser,
    );
    expect(result.isSuccess).toBe(true);

    // This user sees false
    const configUser = createConfigAccessor(registry, resolver, 1, normalUser.id, db);
    expect(await configUser("notifications.pushEnabled")).toBe(false);

    // Other user still sees default (true)
    const configOther = createConfigAccessor(registry, resolver, 1, tenantAdmin.id, db);
    expect(await configOther("notifications.pushEnabled")).toBe(true);
  });

  test("tenant-level default overrides declared default", async () => {
    // Admin sets tenant-level default to false
    const result = await callWrite(
      "config.set",
      {
        key: "notifications.pushEnabled",
        value: false,
        scope: "tenant",
      },
      tenantAdmin,
    );
    expect(result.isSuccess).toBe(true);

    // User who hasn't set their own value now sees false (tenant default)
    const configAdmin = createConfigAccessor(registry, resolver, 1, tenantAdmin.id, db);
    expect(await configAdmin("notifications.pushEnabled")).toBe(false);

    // User who already set their value still sees their value (false)
    const configUser = createConfigAccessor(registry, resolver, 1, normalUser.id, db);
    expect(await configUser("notifications.pushEnabled")).toBe(false);
  });
});

// --- Scenario 6: Feature setting per tenant ---

describe("scenario 6: feature number setting per tenant", () => {
  test("returns typed number default", async () => {
    const configFn = createConfigAccessor(registry, resolver, 1, normalUser.id, db);
    const value = await configFn("orders.maxOrderCount");
    expect(value).toBe(100);
    expect(typeof value).toBe("number");
  });

  test("Admin sets number value, code can do > comparison", async () => {
    const result = await callWrite(
      "config.set",
      {
        key: "orders.maxOrderCount",
        value: 50,
      },
      tenantAdmin,
    );
    expect(result.isSuccess).toBe(true);

    const configFn = createConfigAccessor(registry, resolver, 1, normalUser.id, db);
    const maxOrders = await configFn("orders.maxOrderCount");

    // This is the real test: the code can do > with the value
    expect(typeof maxOrders).toBe("number");
    expect((maxOrders as number) > 25).toBe(true);
    expect((maxOrders as number) > 75).toBe(false);
  });

  test("different tenants have different values", async () => {
    // Tenant 2 admin sets their own limit
    const result = await callWrite(
      "config.set",
      {
        key: "orders.maxOrderCount",
        value: 200,
      },
      otherTenantAdmin,
    );
    expect(result.isSuccess).toBe(true);

    const configT1 = createConfigAccessor(registry, resolver, 1, normalUser.id, db);
    const configT2 = createConfigAccessor(registry, resolver, 2, otherTenantAdmin.id, db);

    expect(await configT1("orders.maxOrderCount")).toBe(50);
    expect(await configT2("orders.maxOrderCount")).toBe(200);
  });
});

// --- ctx.config() integration ---

describe("ctx.config() in handler context", () => {
  test("handler can read config via ctx.config()", async () => {
    const configFn = createConfigAccessor(registry, resolver, 1, tenantAdmin.id, db);

    // Simulate what a handler would do
    const maxOrders = await configFn("orders.maxOrderCount");
    const currentOrders = 60;

    if (typeof maxOrders === "number" && currentOrders > maxOrders) {
      // Would reject
      expect(true).toBe(true);
    } else {
      expect(false).toBe(true); // Should not reach here, 60 > 50
    }
  });
});

// --- config.values query ---

describe("config.values query handler", () => {
  test("returns all visible config values for user", async () => {
    const values = (await callQuery("config.values", {}, tenantAdmin)) as Record<
      string,
      { value: unknown; scope: string }
    >;

    // Admin should see app.serviceUrl, app.mailServer, invoicing.mailSignature, etc.
    expect(values["app.serviceUrl"]).toBeDefined();
    expect(values["app.mailServer"]).toBeDefined();
    expect(values["invoicing.mailSignature"]).toBeDefined();
    expect(values["notifications.pushEnabled"]).toBeDefined();
    expect(values["orders.maxOrderCount"]).toBeDefined();
  });

  test("filters by read access", async () => {
    const values = (await callQuery("config.values", {}, normalUser)) as Record<
      string,
      { value: unknown; scope: string }
    >;

    // normalUser (role: User) should see "all" read access keys
    expect(values["invoicing.mailSignature"]).toBeDefined(); // read: ["all"]
    expect(values["notifications.pushEnabled"]).toBeDefined(); // read: ["all"]
    expect(values["orders.maxOrderCount"]).toBeDefined(); // read: ["all"]

    // But NOT keys restricted to Admin/SystemAdmin
    expect(values["app.serviceUrl"]).toBeUndefined(); // read: ["Admin", "SystemAdmin"]
    expect(values["app.mailServer"]).toBeUndefined(); // read: ["Admin", "SystemAdmin"]
  });
});

// --- config.schema query ---

describe("config.schema query handler", () => {
  test("returns key definitions filtered by read access", async () => {
    const schema = (await callQuery("config.schema", {}, normalUser)) as Record<string, unknown>;

    expect(schema["invoicing.mailSignature"]).toBeDefined();
    expect(schema["app.serviceUrl"]).toBeUndefined();
  });
});

// --- Type validation ---

describe("type validation", () => {
  test("rejects string for number key", async () => {
    const result = await callWrite(
      "config.set",
      {
        key: "orders.maxOrderCount",
        value: "not a number",
      },
      tenantAdmin,
    );
    // Zod will reject this because value is z.union([z.string(), z.number(), z.boolean()])
    // But our handler does additional type validation
    // Actually the value passes zod (it's a string), but our type check catches it
    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) expect(result.error).toContain("type_error");
  });

  test("rejects number for boolean key", async () => {
    const result = await callWrite(
      "config.set",
      {
        key: "notifications.pushEnabled",
        value: 42,
      },
      normalUser,
    );
    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) expect(result.error).toContain("type_error");
  });

  test("rejects unknown config key", async () => {
    const result = await callWrite(
      "config.set",
      {
        key: "nonexistent.key",
        value: "test",
      },
      systemAdmin,
    );
    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) expect(result.error).toContain("unknown_config_key");
  });
});

// --- Encrypted config ---

describe("encrypted config", () => {
  test("encrypted value is stored encrypted in DB, read back decrypted", async () => {
    const result = await callWrite(
      "config.set",
      {
        key: "integration.apiSecret",
        value: "sk-super-secret-key-12345",
      },
      systemAdmin,
    );
    expect(result.isSuccess).toBe(true);

    // Read via config accessor — should be decrypted
    const configFn = createConfigAccessor(registry, resolver, 1, systemAdmin.id, db);
    const value = await configFn("integration.apiSecret");
    expect(value).toBe("sk-super-secret-key-12345");

    // Verify raw DB value is NOT plaintext
    const { sql } = await import("drizzle-orm");
    const [raw] = await db.execute(
      sql`SELECT value FROM config_values WHERE key = 'integration.apiSecret'`,
    );
    const rawValue = (raw as Record<string, unknown>)["value"] as string;
    expect(rawValue).not.toBe("sk-super-secret-key-12345");
    expect(rawValue).not.toContain("sk-super-secret");
  });

  test("non-SystemAdmin cannot read encrypted key", async () => {
    const values = (await callQuery("config.values", {}, tenantAdmin)) as Record<string, unknown>;
    expect(values["integration.apiSecret"]).toBeUndefined();
  });

  test("config.values returns masked value for encrypted key even with read access", async () => {
    const values = (await callQuery("config.values", {}, systemAdmin)) as Record<
      string,
      { value: unknown; scope: string }
    >;
    // SystemAdmin has read access but value should still be masked
    expect(values["integration.apiSecret"]).toBeDefined();
    expect(values["integration.apiSecret"]?.value).toBe("••••••");
  });

  test("ctx.config() returns decrypted value", async () => {
    const configFn = createConfigAccessor(registry, resolver, 1, systemAdmin.id, db);
    const value = await configFn("integration.apiSecret");
    expect(value).toBe("sk-super-secret-key-12345");
  });
});

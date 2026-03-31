import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createConfigAccessor, createConfigFeature } from "../../config";
import { type ConfigResolver, createConfigResolver } from "../../config/resolver";
import { CONFIG_TABLE_SQL } from "../../config/table";
import type { DbConnection } from "../../db/connection";
import { createEncryptionProvider } from "../../db/encryption";
import { createRegistry, type PipelineUser, type Registry, type SaveContext } from "../../engine";
import { createTestDb, createTestTable, type TestDb } from "../../testing";
import { createTenantFeature, TENANT_TABLE_SQL } from "../tenant-feature";

// --- Setup ---

let testDb: TestDb;
let db: DbConnection;
let registry: Registry;
let resolver: ConfigResolver;

const systemAdmin: PipelineUser = { id: 1, tenantId: 1, roles: ["SystemAdmin"] };
const tenantAdmin: PipelineUser = { id: 2, tenantId: 1, roles: ["Admin"] };

const configFeature = createConfigFeature();
const tenantFeature = createTenantFeature();
const testEncryptionKey = randomBytes(32).toString("base64");

beforeAll(async () => {
  testDb = await createTestDb();
  db = testDb.db;
  await createTestTable(db, TENANT_TABLE_SQL);
  await createTestTable(db, CONFIG_TABLE_SQL);

  registry = createRegistry([configFeature, tenantFeature]);
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

// --- Scenario 1: SystemAdmin erstellt Tenant ---

describe("scenario 1: tenant.create", () => {
  test("SystemAdmin can create a tenant", async () => {
    const result = await callWrite(
      "tenant.create",
      { key: "acme", name: "ACME Corp" },
      systemAdmin,
    );
    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      const data = result.data as SaveContext;
      expect(data.data["key"]).toBe("acme");
      expect(data.data["name"]).toBe("ACME Corp");
      expect(data.data["isEnabled"]).toBe(true);
      expect(data.isNew).toBe(true);
    }
  });

  test("normal User cannot create a tenant", async () => {
    // Access check happens at dispatcher level, not handler level
    // But the handler has access: { roles: ["SystemAdmin"] }
    // We verify the handler definition has the correct access rule
    const handler = registry.getWriteHandler("tenant.create");
    expect(handler?.access?.roles).toEqual(["SystemAdmin"]);
  });
});

// --- Scenario 2: tenant.me ---

describe("scenario 2: tenant.me", () => {
  test("returns the current user's tenant", async () => {
    const result = await callQuery("tenant.me", {}, systemAdmin);
    const tenant = result as Record<string, unknown>;
    expect(tenant["key"]).toBe("acme");
    expect(tenant["name"]).toBe("ACME Corp");
  });

  test("returns null for non-existent tenant", async () => {
    const otherUser: PipelineUser = { id: 99, tenantId: 999, roles: ["Admin"] };
    const result = await callQuery("tenant.me", {}, otherUser);
    expect(result).toBeNull();
  });
});

// --- Scenario 3: Admin updates Tenant-Stammdaten ---

describe("scenario 3: tenant.update", () => {
  test("Admin can update tenant name", async () => {
    // Get the tenant ID from the created tenant
    const me = (await callQuery("tenant.me", {}, systemAdmin)) as Record<string, unknown>;
    const tenantId = me["id"] as number;

    const result = await callWrite(
      "tenant.update",
      { id: tenantId, changes: { name: "ACME Corporation" } },
      tenantAdmin,
    );
    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      const data = result.data as SaveContext;
      expect(data.data["name"]).toBe("ACME Corporation");
      expect(data.changes).toEqual({ name: "ACME Corporation" });
      expect(data.isNew).toBe(false);
    }
  });

  test("update handler requires Admin or SystemAdmin role", async () => {
    const handler = registry.getWriteHandler("tenant.update");
    expect(handler?.access?.roles).toEqual(["Admin", "SystemAdmin"]);
  });
});

// --- Scenario 4: SystemAdmin disables Tenant ---

describe("scenario 4: tenant.disable", () => {
  test("SystemAdmin can disable a tenant", async () => {
    const me = (await callQuery("tenant.me", {}, systemAdmin)) as Record<string, unknown>;
    const tenantId = me["id"] as number;

    const result = await callWrite("tenant.disable", { id: tenantId }, systemAdmin);
    expect(result.isSuccess).toBe(true);
    if (result.isSuccess) {
      const data = result.data as SaveContext;
      expect(data.data["isEnabled"]).toBe(false);
    }
  });

  test("disable handler requires SystemAdmin role", async () => {
    const handler = registry.getWriteHandler("tenant.disable");
    expect(handler?.access?.roles).toEqual(["SystemAdmin"]);
  });
});

// --- Scenario 5: tenant.list ---

describe("scenario 5: tenant.list", () => {
  test("returns all tenants", async () => {
    // Create a second tenant
    await callWrite("tenant.create", { key: "beta", name: "Beta Inc" }, systemAdmin);

    const result = (await callQuery("tenant.list", {}, systemAdmin)) as {
      rows: Record<string, unknown>[];
      nextCursor: string | null;
    };

    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    const keys = result.rows.map((r) => r["key"]);
    expect(keys).toContain("acme");
    expect(keys).toContain("beta");
  });

  test("list handler requires SystemAdmin role", async () => {
    const handler = registry.getQueryHandler("tenant.list");
    expect(handler?.access?.roles).toEqual(["SystemAdmin"]);
  });
});

// --- Scenario 6: Config integration ---

describe("scenario 6: config integration with tenant", () => {
  test("SystemAdmin sets smtpHost for tenant", async () => {
    const result = await callWrite(
      "config.set",
      { key: "tenant.smtpHost", value: "smtp.acme.com" },
      systemAdmin,
    );
    expect(result.isSuccess).toBe(true);

    const configFn = createConfigAccessor(registry, resolver, 1, systemAdmin.id, db);
    expect(await configFn("tenant.smtpHost")).toBe("smtp.acme.com");
  });

  test("Admin cannot set smtpHost (only SystemAdmin)", async () => {
    const result = await callWrite(
      "config.set",
      { key: "tenant.smtpHost", value: "smtp.hacked.com" },
      tenantAdmin,
    );
    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) expect(result.error).toContain("access_denied");
  });

  test("smtpPass is encrypted and accessible via ctx.config()", async () => {
    const result = await callWrite(
      "config.set",
      { key: "tenant.smtpPass", value: "super-secret-pw" },
      systemAdmin,
    );
    expect(result.isSuccess).toBe(true);

    // ctx.config() decrypts
    const configFn = createConfigAccessor(registry, resolver, 1, systemAdmin.id, db);
    expect(await configFn("tenant.smtpPass")).toBe("super-secret-pw");

    // Admin cannot see smtpPass in config.values (no read access)
    const values = (await callQuery("config.values", {}, tenantAdmin)) as Record<string, unknown>;
    expect(values["tenant.smtpPass"]).toBeUndefined();
  });

  test("maxUsers is system-only, returns default 50", async () => {
    const configFn = createConfigAccessor(registry, resolver, 1, tenantAdmin.id, db);
    expect(await configFn("tenant.maxUsers")).toBe(50);
  });

  test("maxUsers cannot be set by Admin (system-only)", async () => {
    const result = await callWrite(
      "config.set",
      { key: "tenant.maxUsers", value: 100 },
      tenantAdmin,
    );
    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) expect(result.error).toContain("config_key_is_system_only");
  });

  test("maxUsers cannot be set by SystemAdmin either (system-only)", async () => {
    const result = await callWrite(
      "config.set",
      { key: "tenant.maxUsers", value: 100 },
      systemAdmin,
    );
    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) expect(result.error).toContain("config_key_is_system_only");
  });
});

// --- Scenario 7: Access denial ---

describe("scenario 7: access rules on handlers", () => {
  test("all handlers have correct access rules", async () => {
    expect(registry.getWriteHandler("tenant.create")?.access?.roles).toEqual(["SystemAdmin"]);
    expect(registry.getWriteHandler("tenant.update")?.access?.roles).toEqual([
      "Admin",
      "SystemAdmin",
    ]);
    expect(registry.getWriteHandler("tenant.disable")?.access?.roles).toEqual(["SystemAdmin"]);
    expect(registry.getQueryHandler("tenant.list")?.access?.roles).toEqual(["SystemAdmin"]);
    // tenant.me has no access restriction — anyone can see their own tenant
    expect(registry.getQueryHandler("tenant.me")?.access).toBeUndefined();
  });
});

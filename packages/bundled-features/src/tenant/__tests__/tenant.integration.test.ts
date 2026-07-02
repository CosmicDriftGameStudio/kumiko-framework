import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createTestEnvelopeCipher,
  expectErrorIncludes,
  rolesOf,
} from "@cosmicdrift/kumiko-framework/testing";
import { createConfigAccessor, createConfigFeature } from "../../config";
import { ConfigHandlers, ConfigQueries } from "../../config/constants";
import { type ConfigResolver, createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { TenantHandlers, TenantQueries } from "../constants";
import { createTenantFeature } from "../feature";
import { tenantEntity } from "../schema/tenant";

// --- Setup ---

let stack: TestStack;
let db: DbConnection;
let resolver: ConfigResolver;

const systemAdmin = TestUsers.systemAdmin;
const tenantAdmin = createTestUser({ id: 2 });

const configFeature = createConfigFeature();
const tenantFeature = createTenantFeature();
const testEncryptionKey = randomBytes(32).toString("base64");

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(testEncryptionKey);
  resolver = createConfigResolver({ cipher: encryption });

  stack = await setupTestStack({
    features: [configFeature, tenantFeature],
    extraContext: { configResolver: resolver, configEncryption: encryption },
  });
  db = stack.db;

  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafePushTables(db, { configValuesTable });
  await createEventsTable(db);
});

afterAll(async () => {
  await stack.cleanup();
});

// --- Scenario 1: SystemAdmin erstellt Tenant ---

describe("scenario 1: tenant.create", () => {
  test("SystemAdmin can create a tenant", async () => {
    // Explicit id so the following scenarios (tenant.me, update, disable) run
    // against THIS tenant — systemAdmin.tenantId is a fixed UUID in tests.
    const data = await stack.http.writeOk(
      TenantHandlers.create,
      { id: systemAdmin.tenantId, key: "acme", name: "ACME Corp" },
      systemAdmin,
    );
    expect(data!["data"]).toMatchObject({
      key: "acme",
      name: "ACME Corp",
      isEnabled: true,
    });
    expect(data!["isNew"]).toBe(true);
  });

  test("normal User cannot create a tenant", async () => {
    const error = await stack.http.writeErr(
      TenantHandlers.create,
      { key: "hacked", name: "Hacked" },
      tenantAdmin,
    );
    expectErrorIncludes(error, "access_denied");
  });
});

// --- Scenario 2: tenant.me ---

describe("scenario 2: tenant.me", () => {
  test("returns the current user's tenant", async () => {
    const tenant = await stack.http.queryOk<Record<string, unknown>>(
      TenantQueries.me,
      {},
      systemAdmin,
    );
    expect(tenant["key"]).toBe("acme");
    expect(tenant["name"]).toBe("ACME Corp");
  });

  test("returns null for non-existent tenant", async () => {
    const otherUser = createTestUser({ id: 99, tenantId: "00000000-0000-4000-8000-000000000999" });
    const result = await stack.http.queryOk(TenantQueries.me, {}, otherUser);
    expect(result).toBeNull();
  });
});

// --- Scenario 3: Admin updates Tenant-Stammdaten ---

describe("scenario 3: tenant.update", () => {
  test("Admin can update tenant name", async () => {
    const me = await stack.http.queryOk<Record<string, unknown>>(TenantQueries.me, {}, systemAdmin);
    const tenantId = me["id"] as string;

    const data = await stack.http.writeOk(
      TenantHandlers.update,
      { id: tenantId, changes: { name: "ACME Corporation" }, version: 1 },
      tenantAdmin,
    );
    expect(data!["data"]).toMatchObject({
      name: "ACME Corporation",
    });
    expect(data!["changes"]).toEqual({ name: "ACME Corporation" });
    expect(data!["isNew"]).toBe(false);
  });

  test("update handler requires Admin or SystemAdmin role", async () => {
    expect(rolesOf(stack.registry.getWriteHandler(TenantHandlers.update)?.access)).toEqual([
      "Admin",
      "SystemAdmin",
    ]);
  });
});

// --- Scenario 4: SystemAdmin disables Tenant ---

describe("scenario 4: tenant.disable", () => {
  test("SystemAdmin can disable a tenant", async () => {
    const me = await stack.http.queryOk<Record<string, unknown>>(TenantQueries.me, {}, systemAdmin);
    const tenantId = me["id"] as string;

    const data = await stack.http.writeOk(TenantHandlers.disable, { id: tenantId }, systemAdmin);
    expect(data!["data"]).toMatchObject({
      isEnabled: false,
    });
  });

  test("disable handler requires SystemAdmin role", async () => {
    expect(rolesOf(stack.registry.getWriteHandler(TenantHandlers.disable)?.access)).toEqual([
      "SystemAdmin",
    ]);
  });

  test("SystemAdmin can re-enable a disabled tenant", async () => {
    const me = await stack.http.queryOk<Record<string, unknown>>(TenantQueries.me, {}, systemAdmin);
    const tenantId = me["id"] as string;

    const data = await stack.http.writeOk(TenantHandlers.enable, { id: tenantId }, systemAdmin);
    expect(data!["data"]).toMatchObject({
      isEnabled: true,
    });
  });

  test("enable handler requires SystemAdmin role", async () => {
    expect(rolesOf(stack.registry.getWriteHandler(TenantHandlers.enable)?.access)).toEqual([
      "SystemAdmin",
    ]);
  });
});

// --- Scenario 5: tenant.list ---

describe("scenario 5: tenant.list", () => {
  test("returns all tenants", async () => {
    await stack.http.writeOk(TenantHandlers.create, { key: "beta", name: "Beta Inc" }, systemAdmin);

    const result = await stack.http.queryOk<{
      rows: Record<string, unknown>[];
      nextCursor: string | null;
    }>(TenantQueries.list, {}, systemAdmin);

    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    const keys = result.rows.map((r) => r["key"]);
    expect(keys).toContain("acme");
    expect(keys).toContain("beta");
  });

  test("list handler requires SystemAdmin role", async () => {
    expect(rolesOf(stack.registry.getQueryHandler(TenantQueries.list)?.access)).toEqual([
      "SystemAdmin",
    ]);
  });
});

// --- Scenario 6: Config integration ---

describe("scenario 6: config integration with tenant", () => {
  test("SystemAdmin sets smtpHost for tenant", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "tenant:config:smtp-host", value: "smtp.acme.com" },
      systemAdmin,
    );

    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      systemAdmin.id,
      db,
    );
    expect(await configFn("tenant:config:smtp-host")).toBe("smtp.acme.com");
  });

  test("Admin cannot set smtpHost (only SystemAdmin)", async () => {
    const error = await stack.http.writeErr(
      ConfigHandlers.set,
      { key: "tenant:config:smtp-host", value: "smtp.hacked.com" },
      tenantAdmin,
    );
    expectErrorIncludes(error, "access_denied");
  });

  test("smtpPass is encrypted and accessible via ctx.config()", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "tenant:config:smtp-pass", value: "super-secret-pw" },
      systemAdmin,
    );

    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      systemAdmin.id,
      db,
    );
    expect(await configFn("tenant:config:smtp-pass")).toBe("super-secret-pw");

    // Admin cannot see smtpPass in config.values (no read access)
    const values = await stack.http.queryOk<Record<string, unknown>>(
      ConfigQueries.values,
      {},
      tenantAdmin,
    );
    expect(values["tenant:config:smtp-pass"]).toBeUndefined();
  });

  test("maxUsers is system-only, returns default 50", async () => {
    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      tenantAdmin.id,
      db,
    );
    expect(await configFn("tenant:config:max-users")).toBe(50);
  });

  test("maxUsers cannot be set by Admin (system-only)", async () => {
    const error = await stack.http.writeErr(
      ConfigHandlers.set,
      { key: "tenant:config:max-users", value: 100 },
      tenantAdmin,
    );
    expectErrorIncludes(error, "config_key_is_system_only");
  });

  test("maxUsers cannot be set by SystemAdmin either (system-only)", async () => {
    const error = await stack.http.writeErr(
      ConfigHandlers.set,
      { key: "tenant:config:max-users", value: 100 },
      systemAdmin,
    );
    expectErrorIncludes(error, "config_key_is_system_only");
  });

  test("companyName: Tenant-Admin sets, all read", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "tenant:config:company-name", value: "ACME GmbH" },
      tenantAdmin,
    );
    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      tenantAdmin.id,
      db,
    );
    expect(await configFn("tenant:config:company-name")).toBe("ACME GmbH");
  });

  test("locale: select with valid option succeeds, invalid option rejected", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "tenant:config:locale", value: "fr" },
      tenantAdmin,
    );
    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      tenantAdmin.id,
      db,
    );
    expect(await configFn("tenant:config:locale")).toBe("fr");

    const invalid = await stack.http.writeErr(
      ConfigHandlers.set,
      { key: "tenant:config:locale", value: "klingon" },
      tenantAdmin,
    );
    expectErrorIncludes(invalid, "invalid_option");
  });

  test("timezone: defaults to Europe/Berlin when unset", async () => {
    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      tenantAdmin.id,
      db,
    );
    expect(await configFn("tenant:config:timezone")).toBe("Europe/Berlin");
  });

  test("priceModel: system-only, defaults to basic, Admin cannot override", async () => {
    const configFn = createConfigAccessor(
      stack.registry,
      resolver,
      "00000000-0000-4000-8000-000000000001",
      tenantAdmin.id,
      db,
    );
    expect(await configFn("tenant:config:price-model")).toBe("basic");

    const error = await stack.http.writeErr(
      ConfigHandlers.set,
      { key: "tenant:config:price-model", value: "pro" },
      tenantAdmin,
    );
    expectErrorIncludes(error, "config_key_is_system_only");
  });
});

// --- Scenario 7: Access denial ---

describe("scenario 7: access rules on handlers", () => {
  test("all handlers have correct access rules", async () => {
    // "system" für seed-migrations + ops-tooling, "SystemAdmin" für UI-Operator
    expect(rolesOf(stack.registry.getWriteHandler(TenantHandlers.create)?.access)).toEqual([
      "system",
      "SystemAdmin",
    ]);
    expect(rolesOf(stack.registry.getWriteHandler(TenantHandlers.update)?.access)).toEqual([
      "Admin",
      "SystemAdmin",
    ]);
    expect(rolesOf(stack.registry.getWriteHandler(TenantHandlers.disable)?.access)).toEqual([
      "SystemAdmin",
    ]);
    // updateMemberRoles akzeptiert "system" (für seed-migrations + ops-tooling)
    // PLUS "SystemAdmin" (echter Operator-Pfad). Symmetrisch zu create.
    expect(
      rolesOf(stack.registry.getWriteHandler(TenantHandlers.updateMemberRoles)?.access),
    ).toEqual(["system", "SystemAdmin"]);
    expect(rolesOf(stack.registry.getQueryHandler(TenantQueries.list)?.access)).toEqual([
      "SystemAdmin",
    ]);
    expect(stack.registry.getQueryHandler(TenantQueries.me)?.access).toEqual({
      openToAll: true,
    });
  });
});

// --- Scenario 8: entityList/entityEdit convention QNs ---
//
// The SystemAdmin tenant-list/tenant-edit screens resolve data through the
// entity-suffixed convention QNs (tenant:query:tenant:{list,detail},
// tenant:write:tenant:update), which were added alongside the legacy
// tenant:query:list / tenant:write:update handlers. The boot-validator does NOT
// check that an entityEdit has a matching update/detail handler, so this is the
// only thing that proves the screens have a live data path. Literal QNs on
// purpose — they ARE the wire contract the renderer computes.

describe("scenario 8: entityList/entityEdit convention QNs", () => {
  test("tenant:query:tenant:list returns all tenants for SystemAdmin (systemScope)", async () => {
    const result = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      "tenant:query:tenant:list",
      {},
      systemAdmin,
    );
    // acme + beta exist from earlier scenarios — systemScope yields all tenants.
    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    expect(result.rows.map((r) => r["key"])).toEqual(expect.arrayContaining(["acme", "beta"]));
  });

  test("tenant:query:tenant:detail + tenant:write:tenant:update round-trip (entityEdit save persists)", async () => {
    const created = await stack.http.writeOk(
      "tenant:write:create",
      { key: "delta", name: "Delta" },
      systemAdmin,
    );
    const id = (created!["data"] as Record<string, unknown>)["id"] as string;

    // entityEdit loads the row via the detail QN, edits, then saves via update.
    const loaded = await stack.http.queryOk<Record<string, unknown>>(
      "tenant:query:tenant:detail",
      { id },
      systemAdmin,
    );
    expect(loaded["name"]).toBe("Delta");

    await stack.http.writeOk(
      "tenant:write:tenant:update",
      { id, version: loaded["version"], changes: { name: "Delta GmbH" } },
      systemAdmin,
    );

    const reloaded = await stack.http.queryOk<Record<string, unknown>>(
      "tenant:query:tenant:detail",
      { id },
      systemAdmin,
    );
    expect(reloaded["name"]).toBe("Delta GmbH");
  });

  test("the convention handlers are SystemAdmin-gated", () => {
    expect(rolesOf(stack.registry.getQueryHandler("tenant:query:tenant:list")?.access)).toEqual([
      "SystemAdmin",
    ]);
    expect(rolesOf(stack.registry.getQueryHandler("tenant:query:tenant:detail")?.access)).toEqual([
      "SystemAdmin",
    ]);
    expect(rolesOf(stack.registry.getWriteHandler("tenant:write:tenant:update")?.access)).toEqual([
      "SystemAdmin",
    ]);
  });
});

// Privilege-escalation guard: platform-global/reserved roles must never be
// writable into a tenant membership, not even by a SystemAdmin — once present
// they merge flat into the session and grant cross-tenant authority. The
// forbidden-role check runs before any DB access, so these reject without the
// memberships table being mounted in this stack.
describe("scenario 9: membership role escalation guard", () => {
  const FORBIDDEN_ROLES = ["SystemAdmin", "system", "all", "anonymous"];

  test("add-member rejects reserved/global roles even for SystemAdmin", async () => {
    for (const role of FORBIDDEN_ROLES) {
      const err = await stack.http.writeErr(
        TenantHandlers.addMember,
        { userId: systemAdmin.id, tenantId: systemAdmin.tenantId, roles: [role] },
        systemAdmin,
      );
      expectErrorIncludes(err, "access_denied");
    }
  });

  test("update-member-roles rejects reserved/global roles even for SystemAdmin", async () => {
    for (const role of FORBIDDEN_ROLES) {
      const err = await stack.http.writeErr(
        TenantHandlers.updateMemberRoles,
        { userId: systemAdmin.id, tenantId: systemAdmin.tenantId, roles: [role] },
        systemAdmin,
      );
      expectErrorIncludes(err, "access_denied");
    }
  });
});

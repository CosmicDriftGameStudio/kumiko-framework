import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-framework/testing";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../../config";
import { type ConfigResolver, createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity } from "../../tenant/schema/tenant";
import { TierEngineHandlers, TierEngineQueries } from "../constants";
import { tierAssignmentEntity } from "../entity";
import { tierEngineFeature } from "../feature";

// --- Setup ---
//
// Test-Isolation-Pattern: jeder Test nutzt einen eigenen Tenant über
// `createTestUser({ id: N, tenantId: testTenantId(N) })`. Dadurch teilen
// die Tests keinen Zustand — wenn ein Test fehlschlägt, bleiben die anderen
// aussagekräftig. Zusätzlicher Vorteil: list-Test sieht garantiert genau
// 1 Row, weil sonst keine andere Test-Aktivität in seinem Tenant läuft.

let stack: TestStack;
let db: DbConnection;
let resolver: ConfigResolver;

const configFeature = createConfigFeature();
const tenantFeature = createTenantFeature();
const testEncryptionKey = randomBytes(32).toString("base64");

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(testEncryptionKey);
  resolver = createConfigResolver({ cipher: encryption });

  stack = await setupTestStack({
    features: [configFeature, tenantFeature, tierEngineFeature],
    extraContext: { configResolver: resolver, configEncryption: encryption },
  });
  db = stack.db;

  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafeCreateEntityTable(db, tierAssignmentEntity);
  await unsafePushTables(db, { configValuesTable });
  await createEventsTable(db);
});

afterAll(async () => {
  await stack.cleanup();
});

// Per-test admin-user factory — fresh tenant per scenario.
function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

// --- Scenario 1: create ---

describe("scenario 1: create", () => {
  test("admin creates a tier-assignment for the calling tenant", async () => {
    const admin = adminFor(101);

    const result = await stack.http.writeOk(TierEngineHandlers.create, { tier: "pro" }, admin);

    const data = result!["data"] as Record<string, unknown>;
    expect(data["tier"]).toBe("pro");
    expect(typeof data["id"]).toBe("string");
    expect(result!["isNew"]).toBe(true);
  });
});

// --- Scenario 2: update ---

describe("scenario 2: update", () => {
  test("admin updates the tier value via {id, version, changes}", async () => {
    const admin = adminFor(102);

    const created = await stack.http.writeOk(TierEngineHandlers.create, { tier: "pro" }, admin);
    const id = (created!["data"] as Record<string, unknown>)["id"] as string;

    const updated = await stack.http.writeOk(
      TierEngineHandlers.update,
      { id, version: 1, changes: { tier: "business" } },
      admin,
    );

    const data = updated!["data"] as Record<string, unknown>;
    expect(data["tier"]).toBe("business");
    expect(updated!["isNew"]).toBe(false);
  });
});

// --- Scenario 3: get-active-tier ---

describe("scenario 3: get-active-tier", () => {
  test("returns the current tier for the calling tenant", async () => {
    const admin = adminFor(103);
    await stack.http.writeOk(TierEngineHandlers.create, { tier: "starter" }, admin);

    const result = await stack.http.queryOk<Record<string, unknown> | null>(
      TierEngineQueries.getActiveTier,
      {},
      admin,
    );

    expect(result).not.toBeNull();
    expect(result!["tier"]).toBe("starter");
  });

  test("returns null when no tier is set for the calling tenant", async () => {
    const adminWithoutTier = adminFor(104);

    const result = await stack.http.queryOk<Record<string, unknown> | null>(
      TierEngineQueries.getActiveTier,
      {},
      adminWithoutTier,
    );

    expect(result).toBeNull();
  });
});

// --- Scenario 4: list (auto tenant-scoped) ---

describe("scenario 4: list", () => {
  test("returns the tier-assignment(s) for the calling tenant only", async () => {
    const admin = adminFor(105);
    await stack.http.writeOk(TierEngineHandlers.create, { tier: "team" }, admin);

    const result = await stack.http.queryOk<{
      rows: Record<string, unknown>[];
      nextCursor: string | null;
    }>(TierEngineQueries.list, {}, admin);

    expect(Array.isArray(result.rows)).toBe(true);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]!["tier"]).toBe("team");
  });
});

// --- Scenario 5: tenant isolation (Kern-Versprechen) ---

describe("scenario 5: tenant isolation", () => {
  test("two tenants have independent tier-assignments — no cross-bleed", async () => {
    const adminA = adminFor(201);
    const adminB = adminFor(202);

    await stack.http.writeOk(TierEngineHandlers.create, { tier: "pro" }, adminA);
    await stack.http.writeOk(TierEngineHandlers.create, { tier: "business" }, adminB);

    const tierA = await stack.http.queryOk<Record<string, unknown> | null>(
      TierEngineQueries.getActiveTier,
      {},
      adminA,
    );
    const tierB = await stack.http.queryOk<Record<string, unknown> | null>(
      TierEngineQueries.getActiveTier,
      {},
      adminB,
    );

    expect(tierA!["tier"]).toBe("pro");
    expect(tierB!["tier"]).toBe("business");

    // List as A returns only A's row, never B's.
    const listA = await stack.http.queryOk<{
      rows: Record<string, unknown>[];
      nextCursor: string | null;
    }>(TierEngineQueries.list, {}, adminA);
    expect(listA.rows.length).toBe(1);
    expect(listA.rows[0]!["tier"]).toBe("pro");

    const listB = await stack.http.queryOk<{
      rows: Record<string, unknown>[];
      nextCursor: string | null;
    }>(TierEngineQueries.list, {}, adminB);
    expect(listB.rows.length).toBe(1);
    expect(listB.rows[0]!["tier"]).toBe("business");
  });
});

// --- Scenario 6: access control (negative tests) ---

describe("scenario 6: access control", () => {
  test("normal User (no admin role) cannot create a tier-assignment", async () => {
    const normalUser = TestUsers.user; // tenant 1, role: User

    const error = await stack.http.writeErr(TierEngineHandlers.create, { tier: "pro" }, normalUser);

    expectErrorIncludes(error, "access_denied");
  });

  test("normal User cannot update a tier-assignment", async () => {
    const admin = adminFor(301);
    const created = await stack.http.writeOk(TierEngineHandlers.create, { tier: "pro" }, admin);
    const id = (created!["data"] as Record<string, unknown>)["id"] as string;

    // Same tenant as admin (tenant 301), but a User role instead of admin.
    const normalUserSameTenant = createTestUser({
      id: 302,
      tenantId: testTenantId(301),
      roles: ["User"],
    });

    const error = await stack.http.writeErr(
      TierEngineHandlers.update,
      { id, version: 1, changes: { tier: "business" } },
      normalUserSameTenant,
    );

    expectErrorIncludes(error, "access_denied");
  });

  test("TenantAdmin (ohne SystemAdmin) cannot create a tier-assignment — Self-Upgrade-Schutz", async () => {
    // Tier-Wechsel ist Plattform-/Billing-Hoheit: ein Tenant-Admin darf
    // seinen eigenen Tier NICHT setzen (sonst Gratis-Self-Upgrade).
    const tenantAdmin = createTestUser({
      id: 310,
      tenantId: testTenantId(310),
      roles: ["TenantAdmin"],
    });

    const error = await stack.http.writeErr(
      TierEngineHandlers.create,
      { tier: "pro" },
      tenantAdmin,
    );

    expectErrorIncludes(error, "access_denied");
  });

  test("TenantAdmin cannot update a tier-assignment", async () => {
    const sysadmin = createTestUser({
      id: 311,
      tenantId: testTenantId(311),
      roles: ["SystemAdmin"],
    });
    const created = await stack.http.writeOk(TierEngineHandlers.create, { tier: "free" }, sysadmin);
    const id = (created!["data"] as Record<string, unknown>)["id"] as string;

    // Selber Tenant, aber reiner TenantAdmin → darf den Tier nicht ändern.
    const tenantAdmin = createTestUser({
      id: 312,
      tenantId: testTenantId(311),
      roles: ["TenantAdmin"],
    });

    const error = await stack.http.writeErr(
      TierEngineHandlers.update,
      { id, version: 1, changes: { tier: "agency" } },
      tenantAdmin,
    );

    expectErrorIncludes(error, "access_denied");
  });

  test("SystemAdmin (ohne TenantAdmin) CAN create a tier-assignment", async () => {
    const sysadmin = createTestUser({
      id: 313,
      tenantId: testTenantId(313),
      roles: ["SystemAdmin"],
    });

    const result = await stack.http.writeOk(TierEngineHandlers.create, { tier: "team" }, sysadmin);

    expect((result!["data"] as Record<string, unknown>)["tier"]).toBe("team");
  });

  test("query handlers carry the admin-only access rule (config-level check)", () => {
    // (siehe Scenario 7 für die set-tenant-tier/get-tenant-tier Reads)
    // Read-access is enforced by the same role-rule set on the query handler.
    // We assert the rule is registered correctly — covers regression when
    // someone changes adminAccess to openToAll without noticing.
    const listRule = stack.registry.getQueryHandler(TierEngineQueries.list)?.access;
    const activeTierRule = stack.registry.getQueryHandler(TierEngineQueries.getActiveTier)?.access;

    expect(listRule).toBeDefined();
    expect(activeTierRule).toBeDefined();
    // Roles array contains TenantAdmin + SystemAdmin (no anonymous, no User).
    expect(JSON.stringify(listRule)).toMatch(/TenantAdmin/);
    expect(JSON.stringify(listRule)).toMatch(/SystemAdmin/);
    expect(JSON.stringify(activeTierRule)).toMatch(/TenantAdmin/);
    expect(JSON.stringify(activeTierRule)).toMatch(/SystemAdmin/);
  });
});

// --- Scenario 7: manueller cross-tenant Tier-Grant (set-tenant-tier) ---
//
// Kern-Sicherheitsgrenze von #434: ein SystemAdmin sitzt in seinem eigenen
// Tenant, setzt aber das Tier eines FREMDEN Tenants — ohne Billing-Kauf.
// Der Event muss im Stream des Ziel-Tenants landen (nicht im Admin-Tenant),
// `source: "manual"` tragen und nur für SystemAdmin erreichbar sein.

type SetTenantTierResult = { tenantId: string; tier: string; isNew: boolean };

describe("scenario 7: cross-tenant manual grant", () => {
  test("SystemAdmin sets a FOREIGN tenant's tier — lands in the target stream, source=manual", async () => {
    const adminTenant = testTenantId(401);
    const targetTenant = testTenantId(402);
    const sysadmin = createTestUser({ id: 401, tenantId: adminTenant, roles: ["SystemAdmin"] });

    const result = await stack.http.writeOk<SetTenantTierResult>(
      TierEngineHandlers.setTenantTier,
      { tenantId: targetTenant, tier: "pro" },
      sysadmin,
    );
    expect(result.tenantId).toBe(targetTenant);
    expect(result.tier).toBe("pro");
    expect(result.isNew).toBe(true);

    // Beweis, dass der Event im Ziel-Stream liegt: ein Admin IM Ziel-Tenant
    // liest sein eigenes get-active-tier (own-tenant-scoped) und sieht "pro".
    const targetAdmin = createTestUser({ id: 402, tenantId: targetTenant, roles: ["TenantAdmin"] });
    const seenByTarget = await stack.http.queryOk<Record<string, unknown> | null>(
      TierEngineQueries.getActiveTier,
      {},
      targetAdmin,
    );
    expect(seenByTarget!["tier"]).toBe("pro");

    // get-tenant-tier (cross-tenant Read, SystemAdmin) liefert source=manual.
    const grant = await stack.http.queryOk<Record<string, unknown> | null>(
      TierEngineQueries.getTenantTier,
      { tenantId: targetTenant },
      sysadmin,
    );
    expect(grant!["tier"]).toBe("pro");
    expect(grant!["source"]).toBe("manual");

    // Der Admin-eigene Tenant bleibt unberührt — kein Tier dort geleakt.
    const seenByAdmin = await stack.http.queryOk<Record<string, unknown> | null>(
      TierEngineQueries.getActiveTier,
      {},
      sysadmin,
    );
    expect(seenByAdmin).toBeNull();
  });

  test("upsert is idempotent — second set updates the same aggregate (isNew:false)", async () => {
    const sysadmin = createTestUser({
      id: 410,
      tenantId: testTenantId(410),
      roles: ["SystemAdmin"],
    });
    const target = testTenantId(411);

    const first = await stack.http.writeOk<SetTenantTierResult>(
      TierEngineHandlers.setTenantTier,
      { tenantId: target, tier: "pro" },
      sysadmin,
    );
    expect(first.isNew).toBe(true);

    const second = await stack.http.writeOk<SetTenantTierResult>(
      TierEngineHandlers.setTenantTier,
      { tenantId: target, tier: "business" },
      sysadmin,
    );
    expect(second.isNew).toBe(false);
    expect(second.tier).toBe("business");

    const grant = await stack.http.queryOk<Record<string, unknown> | null>(
      TierEngineQueries.getTenantTier,
      { tenantId: target },
      sysadmin,
    );
    expect(grant!["tier"]).toBe("business");
  });

  test("TenantAdmin cannot set a foreign tenant's tier — fail-closed", async () => {
    const tenantAdmin = createTestUser({
      id: 420,
      tenantId: testTenantId(420),
      roles: ["TenantAdmin"],
    });

    const error = await stack.http.writeErr(
      TierEngineHandlers.setTenantTier,
      { tenantId: testTenantId(421), tier: "pro" },
      tenantAdmin,
    );
    expectErrorIncludes(error, "access_denied");
  });

  test("normal User cannot set a tier and cannot read get-tenant-tier", async () => {
    const normalUser = TestUsers.user;

    const writeError = await stack.http.writeErr(
      TierEngineHandlers.setTenantTier,
      { tenantId: testTenantId(431), tier: "pro" },
      normalUser,
    );
    expectErrorIncludes(writeError, "access_denied");

    const res = await stack.http.query(
      TierEngineQueries.getTenantTier,
      { tenantId: testTenantId(431) },
      normalUser,
    );
    expect(res.status).toBe(403);
  });
});

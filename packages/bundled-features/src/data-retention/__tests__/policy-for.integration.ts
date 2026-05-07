// retention:query:policy-for Integration-Test (S2.D3) — Cross-Feature-
// API für Forget-Flow + Cleanup-Job. Round-trip: Override in DB seeden,
// Query rufen, verify dass resolver Override greift.

import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntityTable,
  createTestUser,
  setupTestStack,
  testTenantId,
  type TestStack,
  TestUsers,
} from "@cosmicdrift/kumiko-framework/stack";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDataRetentionFeature, tenantRetentionOverrideEntity } from "../feature";
import { tenantRetentionOverrideTable } from "../schema/tenant-retention-override";

const POLICY_FOR = "data-retention:query:policy-for";

let stack: TestStack;
let db: DbConnection;

const feature = createDataRetentionFeature();

const overrideExecutor = createEventStoreExecutor(
  tenantRetentionOverrideTable,
  tenantRetentionOverrideEntity,
  { entityName: "tenant-retention-override" },
);

async function seedOverride(
  tenantId: string,
  entityName: string,
  config: Record<string, unknown>,
  reason = "test-setup",
): Promise<void> {
  const by = { ...TestUsers.systemAdmin, tenantId };
  const tdb = createTenantDb(db, tenantId, "system");
  const result = await overrideExecutor.create(
    {
      entityName,
      config: JSON.stringify(config),
      reason,
      tenantId,
    },
    by,
    tdb,
  );
  if (!result.isSuccess) {
    throw new Error(`seedOverride failed: ${JSON.stringify(result)}`);
  }
}

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  db = stack.db;
  await createEntityTable(db, tenantRetentionOverrideEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("data-retention :: policy-for query (S2.D3)", () => {
  test("ohne Override + ohne Entity-Default + ohne Preset → source=none", async () => {
    const user = createTestUser({
      id: 1,
      tenantId: testTenantId(1),
      roles: ["TenantAdmin"],
    });
    const result = await stack.http.queryOk<{
      entityName: string;
      policy: unknown;
      source: string;
    }>(POLICY_FOR, { entityName: "ghost-entity" }, user);
    expect(result.entityName).toBe("ghost-entity");
    expect(result.policy).toBeNull();
    expect(result.source).toBe("none");
  });

  test("mit Override → resolver liefert source=override + override-Werte", async () => {
    const tenantId = testTenantId(2);
    const user = createTestUser({ id: 2, tenantId, roles: ["TenantAdmin"] });

    await seedOverride(
      tenantId,
      "session",
      { keepFor: "60d", strategy: "hardDelete", reference: "lastSeenAt" },
    );

    const result = await stack.http.queryOk<{
      policy: { keepFor: string; strategy: string; reference?: string } | null;
      source: string;
    }>(POLICY_FOR, { entityName: "session" }, user);

    expect(result.source).toBe("override");
    expect(result.policy?.keepFor).toBe("60d");
    expect(result.policy?.strategy).toBe("hardDelete");
    expect(result.policy?.reference).toBe("lastSeenAt");
  });

  test("Override nur strategy + keine Base → source=override-incomplete (Sprint 2.D1 Audit-Cycle-Fix greift)", async () => {
    const tenantId = testTenantId(3);
    const user = createTestUser({ id: 3, tenantId, roles: ["TenantAdmin"] });

    await seedOverride(
      tenantId,
      "ghost-incomplete",
      { strategy: "hardDelete" }, // keepFor fehlt, kein Preset, kein Entity-Default
    );

    const result = await stack.http.queryOk<{
      policy: unknown;
      source: string;
    }>(POLICY_FOR, { entityName: "ghost-incomplete" }, user);

    expect(result.source).toBe("override-incomplete");
    expect(result.policy).toBeNull();
  });

  test("Override mit Schema-Violation in DB → console.warn, fallback (source=none)", async () => {
    const tenantId = testTenantId(4);
    const user = createTestUser({ id: 4, tenantId, roles: ["TenantAdmin"] });

    // Test-Name korrigiert in S2.D2.5-Audit (N3): "invalid JSON" war
    // missleading — der Test prueft Schema-Violation (gueltiges JSON
    // mit ungueltigem strategy-Enum-Wert), nicht JSON-Parse-Fehler.
    // DB-Direct-Insert via seedOverride mit strategy="delete" — Zod
    // retentionOverrideSchema rejected das.
    await seedOverride(
      tenantId,
      "ghost-corrupt",
      { strategy: "delete" }, // invalid enum value
    );

    const result = await stack.http.queryOk<{
      policy: unknown;
      source: string;
    }>(POLICY_FOR, { entityName: "ghost-corrupt" }, user);

    // Schema-Validation rejected → policy=null + source=none (kein
    // Override betrachtet, faellt auf Layer 2/1 zurueck — beide leer)
    expect(result.source).toBe("none");
  });

  test("Cross-Tenant-Isolation: Tenant A's Override greift nicht für Tenant B", async () => {
    const tenantA = testTenantId(5);
    const tenantB = testTenantId(6);
    const userA = createTestUser({ id: 5, tenantId: tenantA, roles: ["TenantAdmin"] });
    const userB = createTestUser({ id: 6, tenantId: tenantB, roles: ["TenantAdmin"] });

    await seedOverride(
      tenantA,
      "report",
      { keepFor: "1y", strategy: "hardDelete" },
    );

    const resultA = await stack.http.queryOk<{ source: string }>(
      POLICY_FOR,
      { entityName: "report" },
      userA,
    );
    const resultB = await stack.http.queryOk<{ source: string }>(
      POLICY_FOR,
      { entityName: "report" },
      userB,
    );

    expect(resultA.source).toBe("override");
    expect(resultB.source).toBe("none"); // Tenant B sieht Tenant A's Override nicht
  });
});

// fw#2971 — withUnsafeRawGrant was un-exported, so an app-owned CapSpec.usage()
// provider's db.unsafeRaw() call was rejected even though caps:usage itself
// runs with r.systemScope(). caps-usage.query.ts now declares its own
// escapeHatch so those providers keep working. This proves the grant
// actually reaches a cap provider doing a real raw-SQL SUM aggregate (the
// shape a typed TenantDb helper like count() can't express) end to end
// through the real caps:usage HTTP handler.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { asRawClient } from "@cosmicdrift/kumiko-framework/db";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { billingFoundationFeature } from "../../billing-foundation";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity } from "../../tenant/schema/tenant";
import { seedTenant } from "../../tenant/seeding";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle";
import { TierEngineHandlers, tierAssignmentEntity, tierEngineFeature } from "../../tier-engine";
import { CapOverviewQueries } from "../constants";
import { createCapOverviewFeature } from "../feature";
import type { CapSpec } from "../types";

const RAW_USAGE_REASON =
  "test: cap provider sums cap_overview_raw_usage_probe via raw SQL (fw#2971 regression)";
const TENANT_A = testTenantId(9101);

const rawSqlSumCap: CapSpec = {
  id: "raw-sql-sum",
  label: "test.cap.rawSqlSum",
  limit: () => 1000,
  usage: async (db, tenantId) => {
    // @cast-boundary db-operator — unsafeRaw's DbRunner narrows to
    // DbConnection|DbTx; this call site only ever runs outside a tx.
    const raw = asRawClient(db.unsafeRaw(RAW_USAGE_REASON) as DbConnection);
    const rows = await raw.unsafe<{ total: number }>(
      "SELECT COALESCE(SUM(amount), 0)::int AS total FROM cap_overview_raw_usage_probe WHERE tenant_id = $1",
      [tenantId],
    );
    return rows[0]?.total ?? 0;
  },
};

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      billingFoundationFeature,
      tierEngineFeature,
      createCapOverviewFeature({ caps: [rawSqlSumCap] }),
    ],
  });
  db = stack.db;
  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafeCreateEntityTable(db, tierAssignmentEntity);
  await unsafeCreateEntityTable(db, tenantComplianceProfileEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());

  await asRawClient(db).unsafe(`
    CREATE TABLE IF NOT EXISTS cap_overview_raw_usage_probe (
      tenant_id text NOT NULL,
      amount int NOT NULL
    )
  `);
  await asRawClient(db).unsafe(
    "INSERT INTO cap_overview_raw_usage_probe (tenant_id, amount) VALUES ($1, $2), ($1, $3)",
    [TENANT_A, 30, 12],
  );

  await seedTenant(db, { id: TENANT_A, key: `cap-overview-raw-${TENANT_A}`, name: "Tenant Raw" });
  const ownerA = createTestUser({
    id: 91011,
    tenantId: TENANT_A,
    roles: ["TenantAdmin", "SystemAdmin"],
  });
  await stack.http.writeOk(TierEngineHandlers.create, { tier: "pro" }, ownerA);
});

afterAll(async () => {
  await asRawClient(db).unsafe("DROP TABLE IF EXISTS cap_overview_raw_usage_probe");
  await stack.cleanup();
});

describe("caps:usage's own escapeHatch grants a cap provider raw SQL", () => {
  test("a cap provider's db.unsafeRaw() SUM aggregate runs successfully through caps:usage", async () => {
    const memberA = createTestUser({ id: 91012, tenantId: TENANT_A, roles: ["User"] });
    const result = await stack.http.queryOk<{
      rows: readonly { id: string; used: number | null }[];
    }>(CapOverviewQueries.capsUsage, {}, memberA);
    const row = result.rows.find((r) => r.id === rawSqlSumCap.id);
    expect(row?.used).toBe(42);
  });
});

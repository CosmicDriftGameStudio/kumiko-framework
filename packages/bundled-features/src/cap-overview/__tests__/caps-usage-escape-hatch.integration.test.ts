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
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
import { billingFoundationFeature } from "../../billing-foundation/index.js";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.js";
import { createConfigFeature } from "../../config/index.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { seedTenant } from "../../tenant/seeding.js";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.js";
import {
  TierEngineHandlers,
  tierAssignmentEntity,
  tierEngineFeature,
} from "../../tier-engine/index.js";
import { CapOverviewQueries, capFieldName } from "../constants.js";
import { createCapOverviewFeature } from "../feature.js";
import type { CapSpec } from "../types.js";

const TENANT_A = testTenantId(9101);
const TENANT_B = testTenantId(9102);

const rawSqlSumCap: CapSpec = {
  id: "raw-sql-sum",
  label: "test.cap.rawSqlSum",
  limit: () => 1000,
  usage: async (db, tenantId) => {
    // @cast-boundary db-operator — unsafeRaw's DbRunner narrows to
    // DbConnection|DbTx; this call site only ever runs outside a tx.
    const raw = asRawClient(db.unsafeRaw() as DbConnection);
    const rows = await raw.unsafe<{ total: number }>(
      "SELECT COALESCE(SUM(amount), 0)::int AS total FROM cap_overview_raw_usage_probe WHERE tenant_id = $1",
      [tenantId],
    );
    return rows[0]?.total ?? 0;
  },
};

// #2974: tenant-caps:list calls usage()/usageBatch() with the platform-wide systemDb
const rawSqlSumBatchCap: CapSpec = {
  id: "raw-sql-sum-batch",
  label: "test.cap.rawSqlSumBatch",
  limit: () => 1000,
  usage: async () => 0,
  usageBatch: async (db, tenantIds) => {
    const raw = asRawClient(db.unsafeRaw() as DbConnection);
    const rows = await raw.unsafe<{ tenant_id: string; total: number }>(
      "SELECT tenant_id, COALESCE(SUM(amount), 0)::int AS total FROM cap_overview_raw_usage_probe WHERE tenant_id = ANY($1) GROUP BY tenant_id",
      [tenantIds],
    );
    return new Map(rows.map((r) => [r.tenant_id, r.total]));
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
      createCapOverviewFeature({ caps: [rawSqlSumCap, rawSqlSumBatchCap] }),
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
  // Another tenant's rows: the providers' own tenant_id filter is the only thing keeping
  // this out of TENANT_A's sum (the system-mode db handed to them is unfiltered).
  await asRawClient(db).unsafe(
    "INSERT INTO cap_overview_raw_usage_probe (tenant_id, amount) VALUES ($1, $2)",
    [TENANT_B, 500],
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
  resetPiiSubjectKmsForTests();
});

describe("caps:usage's own escapeHatch grants a cap provider raw SQL", () => {
  test("a cap provider's db.unsafeRaw() SUM aggregate runs successfully through caps:usage", async () => {
    const adminA = createTestUser({ id: 91012, tenantId: TENANT_A, roles: ["TenantAdmin"] });
    const result = await stack.http.queryOk<{
      rows: readonly { id: string; used: number | null }[];
    }>(CapOverviewQueries.capsUsage, {}, adminA);
    const row = result.rows.find((r) => r.id === rawSqlSumCap.id);
    expect(row?.used).toBe(42);
  });
});

describe("tenant-caps:list's own escapeHatch grants cap providers raw SQL (#2974)", () => {
  test("usage() and usageBatch() raw SQL SUM aggregates run through tenant-caps:list", async () => {
    const admin = createTestUser({
      id: 91013,
      tenantId: TENANT_A,
      roles: ["TenantAdmin", "SystemAdmin"],
    });
    const result = await stack.http.queryOk<{ rows: readonly Record<string, unknown>[] }>(
      CapOverviewQueries.tenantCapsList,
      {},
      admin,
    );
    const row = result.rows.find((r) => r["tenantId"] === TENANT_A);
    const usedOf = (capId: string) =>
      (row?.[capFieldName(capId)] as { used: number } | undefined)?.used;
    expect(usedOf(rawSqlSumCap.id)).toBe(42);
    expect(usedOf(rawSqlSumBatchCap.id)).toBe(42);
  });
});

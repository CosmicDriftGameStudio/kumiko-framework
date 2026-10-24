// runProdApp moves legacy tenant and membership streams onto their new tenant before the boot
// seeds. The first boot does the work and writes the markers; the second boot short-circuits on
// the markers, which a stream planted between the boots proves (it stays where it is).
// Real Postgres + Redis; legacy streams come from the real executor over a tenant entity copy
// without systemStream/tenancy.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  configValuesTable,
  createConfigFeature,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createTenantFeature,
  tenantEntity,
  tenantMembershipEntity,
  tenantMembershipsTable,
  tenantTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createUserFeature, userEntity } from "@cosmicdrift/kumiko-bundled-features/user";
import {
  createDbConnection,
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { esOperationsTable } from "@cosmicdrift/kumiko-framework/es-ops";
import {
  createArchivedStreamsTable,
  createEventsTable,
  eventsTable,
} from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEventConsumerStateTable,
  createProjectionStateTable,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { createInMemorySearchAdapter } from "@cosmicdrift/kumiko-framework/search";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { unsafeCreateEntityTable, unsafePushTables } from "@cosmicdrift/kumiko-testing/stack";
import { type ProdAppHandle, runProdApp } from "../run-prod-app.ts";

const noAppEnvSchema = composeEnvSchema({ features: [] });

const TEST_DB = `kumiko_runprod_streambf_${Date.now().toString(36)}`;
const ADMIN_URL = process.env["TEST_DATABASE_URL"] ?? "";
const TEST_DB_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);

const SESSION_TENANT = testTenantId(7);
const MEMBER_TENANT = testTenantId(31);
const TENANT_ALPHA = testTenantId(41);
const TENANT_CANARY = testTenantId(44);

const { systemStream: _systemStream, tenancy: _tenancy, ...legacyTenantEntity } = tenantEntity;
const legacyTenantExecutor = createEventStoreExecutor(tenantTable, legacyTenantEntity, {
  entityName: "tenant",
});
const membershipExecutor = createEventStoreExecutor(
  tenantMembershipsTable,
  tenantMembershipEntity,
  { entityName: "tenant-membership" },
);

let handle: ProdAppHandle | undefined;
let testDb: DbConnection;
let closeTestDb: () => Promise<void>;

async function legacyCreateTenant(id: TenantId, key: string, name: string): Promise<void> {
  const tdb = createTenantDb({ db: testDb, tenantId: SESSION_TENANT, mode: "system" });
  const result = await legacyTenantExecutor.create(
    { id, key, name },
    createSystemUser(SESSION_TENANT),
    tdb,
  );
  expect(result.isSuccess).toBe(true);
}

async function streamTenants(aggregateId: string): Promise<string[]> {
  const rows = await selectMany<{ tenantId: string }>(testDb, eventsTable, { aggregateId });
  return rows.map((row) => row.tenantId);
}

async function bootProdApp(): Promise<ProdAppHandle> {
  return runProdApp({
    rowLevelSecurity: "off",
    features: [createConfigFeature(), createUserFeature(), createTenantFeature()],
    allowPlaintextPii: "stream backfill boot test",
    envSource: {
      DATABASE_URL: TEST_DB_URL,
      REDIS_URL: process.env["REDIS_URL"] ?? "redis://localhost:16379",
      JWT_SECRET: "stream-backfill-boot-test-secret-0123456789",
      PORT: "0",
    },
    envSchema: noAppEnvSchema,
    extraContext: { searchAdapter: createInMemorySearchAdapter() },
    autoListen: false,
    migrations: false,
  });
}

beforeAll(async () => {
  if (!ADMIN_URL) throw new Error("TEST_DATABASE_URL must be set");
  const adminClient = new Bun.SQL(ADMIN_URL.replace(/\/[^/]+$/, "/postgres"));
  try {
    await adminClient.unsafe(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await adminClient.close();
  }
  const connection = createDbConnection({ url: TEST_DB_URL, rowLevelSecurity: "off" });
  testDb = connection.db;
  closeTestDb = connection.close;
  await createEventsTable(testDb);
  await createArchivedStreamsTable(testDb);
  await createProjectionStateTable(testDb);
  await createEventConsumerStateTable(testDb);
  await unsafeCreateEntityTable(testDb, userEntity);
  await unsafeCreateEntityTable(testDb, tenantEntity);
  await unsafePushTables(testDb, { configValuesTable, tenantMembershipsTable });
});

afterEach(async () => {
  await handle?.stop();
  handle = undefined;
});

afterAll(async () => {
  await closeTestDb();
  const adminClient = new Bun.SQL(ADMIN_URL.replace(/\/[^/]+$/, "/postgres"));
  try {
    await adminClient.unsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  } finally {
    await adminClient.close();
  }
});

describe("runProdApp stream tenant backfill", () => {
  test("the first boot moves the legacy streams and writes the markers, the second boot does no work", async () => {
    await legacyCreateTenant(TENANT_ALPHA, "alpha", "Alpha Freight");
    const membershipTdb = createTenantDb({ db: testDb, tenantId: MEMBER_TENANT, mode: "system" });
    const membership = await membershipExecutor.create(
      { userId: "legacy-user", tenantId: MEMBER_TENANT, roles: JSON.stringify(["Admin"]) },
      createSystemUser(SESSION_TENANT),
      membershipTdb,
    );
    expect(membership.isSuccess).toBe(true);
    expect(await streamTenants(TENANT_ALPHA)).toEqual([SESSION_TENANT]);

    handle = await bootProdApp();

    expect(await streamTenants(TENANT_ALPHA)).toEqual([SYSTEM_TENANT_ID]);
    const rows = await selectMany<{ tenantId: string }>(testDb, tenantTable, {});
    expect(rows.map((row) => row.tenantId)).toEqual([SYSTEM_TENANT_ID]);
    const memberships = await selectMany<{ id: string; tenantId: string }>(
      testDb,
      tenantMembershipsTable,
      {},
    );
    expect(memberships.map((row) => row.tenantId)).toEqual([MEMBER_TENANT]);
    expect(await streamTenants(memberships[0]?.id ?? "")).toEqual([MEMBER_TENANT]);
    const markers = await selectMany<{ id: string }>(testDb, esOperationsTable, {});
    expect(markers.map((row) => row.id).sort()).toEqual([
      "stream-tenant-backfill:tenant",
      "stream-tenant-backfill:user",
    ]);

    await handle.stop();
    handle = undefined;

    // Planted after the markers exist: a scan would move it, the short-circuit leaves it.
    await legacyCreateTenant(TENANT_CANARY, "canary", "Canary Freight");
    handle = await bootProdApp();
    expect(await streamTenants(TENANT_CANARY)).toEqual([SESSION_TENANT]);
  });
});

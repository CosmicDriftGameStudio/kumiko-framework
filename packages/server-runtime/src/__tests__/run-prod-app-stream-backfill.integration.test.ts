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
  append,
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
const TENANT_LATE = testTenantId(46);

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
  const tdb = createTenantDb({
    db: testDb,
    tenantId: SESSION_TENANT,
    mode: "system",
    reason: "test writes a legacy tenant stream on the acting admin's session tenant",
  });
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

async function createdPayloadOf(
  aggregateId: string,
  key: string,
  name: string,
): Promise<Record<string, unknown>> {
  const rows = await selectMany<{ payload: Record<string, unknown>; type: string }>(
    testDb,
    eventsTable,
    { aggregateId },
  );
  const created = rows.find((row) => row.type === "tenant.created");
  if (!created) throw new Error("template tenant.created event missing");
  return { ...created.payload, key, name };
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
  test("the first boot moves the legacy streams and writes the markers, later boots move late legacy streams and otherwise do nothing", async () => {
    await legacyCreateTenant(TENANT_ALPHA, "alpha", "Alpha Freight");
    const membershipTdb = createTenantDb({
      db: testDb,
      tenantId: MEMBER_TENANT,
      mode: "system",
      reason: "test writes a legacy membership stream on an explicitly named tenant",
    });
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
    await handle.stop();
    handle = undefined;

    // An old pod writes a legacy stream after the first boot: the next boot moves it.
    await legacyCreateTenant(TENANT_CANARY, "canary", "Canary Freight");
    handle = await bootProdApp();
    expect(await streamTenants(TENANT_CANARY)).toEqual([SYSTEM_TENANT_ID]);
    await handle.stop();
    handle = undefined;

    // Boot 3 has nothing to move and does not rebuild: a SYSTEM-stream event stays unprojected.
    await append(testDb, {
      aggregateId: TENANT_LATE,
      aggregateType: "tenant",
      tenantId: SYSTEM_TENANT_ID,
      expectedVersion: 0,
      type: "tenant.created",
      payload: await createdPayloadOf(TENANT_ALPHA, "late", "Late Freight"),
      metadata: { userId: "test-legacy" },
    });
    const rowsBefore = (await selectMany(testDb, tenantTable, {})).length;
    handle = await bootProdApp();
    expect((await selectMany(testDb, tenantTable, {})).length).toBe(rowsBefore);
    // A clean boot writes nothing: no pending row is left, and none was ever needed.
    expect(await selectMany(testDb, esOperationsTable, {})).toEqual([]);
  });
});

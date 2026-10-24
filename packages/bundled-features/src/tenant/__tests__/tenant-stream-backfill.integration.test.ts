// backfillTenantStreamTenants: tenant and membership streams written before `tenant` became a
// global/systemStream entity live on the acting admin's tenant. Legacy data is produced through
// the real executor over a tenant entity copy without systemStream/tenancy, with session tenants
// that are neither SYSTEM nor the member tenant.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import {
  createEventStoreExecutor,
  createTenantDb,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { append, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { SEARCH_CONSUMER_NAME } from "@cosmicdrift/kumiko-framework/pipeline";
import { TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests, resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  drainEventConsumers,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../../config/index.ts";
import { configValuesTable } from "../../config/table.ts";
import { DESTRUCTION_REQUESTED_EVENT_QN } from "../../tenant-lifecycle/constants.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { createTenantFeature } from "../feature.ts";
import { tenantMembershipEntity, tenantMembershipsTable } from "../membership-table.ts";
import { tenantEntity, tenantTable } from "../schema/tenant.ts";
import { seedTenantMembership } from "../seeding.ts";
import { backfillTenantStreamTenants } from "../stream-tenant-backfill.ts";
import { TenantHandlers } from "../web/constants.ts";

const SESSION_TENANT = testTenantId(7);
const FIRST_TENANT = testTenantId(1);
const MEMBER_TENANT_A = testTenantId(31);
const MEMBER_TENANT_B = testTenantId(32);
const ALIGNED_TENANT = testTenantId(33);

const TENANT_ALPHA = testTenantId(41);
const TENANT_BETA = testTenantId(42);
const TENANT_GAMMA = testTenantId(43);

const admin: SessionUser = { ...TestUsers.systemAdmin, tenantId: SESSION_TENANT };
const LIST = "tenant:query:tenant:list";
const DETAIL = "tenant:query:tenant:detail";

const { systemStream: _systemStream, tenancy: _tenancy, ...legacyTenantEntity } = tenantEntity;
const legacyTenantExecutor = createEventStoreExecutor(tenantTable, legacyTenantEntity, {
  entityName: "tenant",
});
const membershipExecutor = createEventStoreExecutor(
  tenantMembershipsTable,
  tenantMembershipEntity,
  { entityName: "tenant-membership" },
);

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createConfigFeature(), createUserFeature(), createTenantFeature()],
    searchConfig: {
      tenantId: SYSTEM_TENANT_ID,
      searchableFields: ["name"],
      rankingFields: ["name"],
    },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

beforeEach(async () => {
  await resetTestTables(stack.db, [userTable, tenantMembershipsTable, tenantTable, eventsTable]);
  await stack.search.dropAllIndexes?.();
  resetPiiSubjectKmsForTests();
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  resetPiiSubjectKmsForTests();
  await stack.cleanup();
});

async function legacyCreateTenant(
  actorTenant: TenantId,
  id: TenantId,
  key: string,
  name: string,
): Promise<void> {
  const tdb = createTenantDb({ db: stack.db, tenantId: actorTenant, mode: "system" });
  const result = await legacyTenantExecutor.create(
    { id, key, name },
    createSystemUser(actorTenant),
    tdb,
  );
  expect(result.isSuccess).toBe(true);
}

async function legacyCreateMembership(
  actorTenant: TenantId,
  memberTenant: TenantId,
  userId: string,
): Promise<void> {
  const tdb = createTenantDb({ db: stack.db, tenantId: memberTenant, mode: "system" });
  const result = await membershipExecutor.create(
    { userId, tenantId: memberTenant, roles: JSON.stringify(["Admin"]) },
    createSystemUser(actorTenant),
    tdb,
  );
  expect(result.isSuccess).toBe(true);
}

type EventRow = { tenantId: string; version: number; type: string };

async function streamOf(aggregateId: string): Promise<EventRow[]> {
  const rows = await selectMany<EventRow & { id: bigint }>(stack.db, eventsTable, { aggregateId });
  return [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
}

async function searchHits(bucket: TenantId, term: string): Promise<string[]> {
  const hits = await stack.search.search(bucket, term, { filterType: "tenant" });
  return hits.map((hit) => String(hit.entityId));
}

async function listIds(term: string): Promise<string[]> {
  const result = await stack.http.queryOk<{ rows: readonly { id: string }[] }>(
    LIST,
    { search: term },
    admin,
  );
  return result.rows.map((row) => row.id);
}

async function seedLegacyEstate(): Promise<void> {
  await legacyCreateTenant(SESSION_TENANT, TENANT_ALPHA, "alpha", "Alpha Freight");
  await legacyCreateTenant(FIRST_TENANT, TENANT_BETA, "beta", "Beta Freight");
  await legacyCreateTenant(SESSION_TENANT, TENANT_GAMMA, "gamma", "Gamma Freight");
  // Split stream: a post-fix write lands on SYSTEM while v1 lives on the old tenant.
  await stack.http.writeOk(TenantHandlers.disable, { id: TENANT_GAMMA }, admin);
  // Lifecycle event on the tenant's own stream (old request-destruction path).
  await append(stack.db, {
    aggregateId: TENANT_ALPHA,
    aggregateType: "tenant",
    tenantId: TENANT_ALPHA,
    expectedVersion: 0,
    type: DESTRUCTION_REQUESTED_EVENT_QN,
    payload: { requestedBy: "test-legacy", gracePeriodEnd: "2099-01-01T00:00:00Z" },
    metadata: { userId: "test-legacy" },
  });
  await legacyCreateMembership(SESSION_TENANT, MEMBER_TENANT_A, TestUsers.user.id);
  await legacyCreateMembership(FIRST_TENANT, MEMBER_TENANT_B, TestUsers.user.id);
  await seedTenantMembership(stack.db, {
    userId: TestUsers.user.id,
    tenantId: ALIGNED_TENANT,
    roles: ["Admin"],
  });
  await drainEventConsumers(stack, [SEARCH_CONSUMER_NAME]);
}

describe("backfillTenantStreamTenants", () => {
  test("moves legacy tenant and membership streams, repairs projections and search, is idempotent", async () => {
    await seedLegacyEstate();
    expect(await searchHits(SESSION_TENANT, "alpha")).toEqual([TENANT_ALPHA]);
    expect(await searchHits(FIRST_TENANT, "beta")).toEqual([TENANT_BETA]);

    const result = await backfillTenantStreamTenants({
      db: stack.db,
      registry: stack.registry,
      searchAdapter: stack.search,
    });

    expect(result.failures).toEqual([]);
    expect(result.tenants.aggregatesMigrated).toBe(3);
    expect(result.memberships.aggregatesMigrated).toBe(2);
    expect(result.searchDocsRemoved).toBe(3);
    expect(result.reindexedTenants).toBe(3);

    for (const id of [TENANT_ALPHA, TENANT_BETA, TENANT_GAMMA]) {
      const events = await streamOf(id);
      expect(events.map((e) => e.tenantId)).toEqual(events.map(() => SYSTEM_TENANT_ID));
      expect(events.map((e) => e.version)).toEqual(events.map((_, i) => i + 1));
    }
    expect((await streamOf(TENANT_GAMMA)).map((e) => e.type)).toEqual([
      "tenant.created",
      "tenant.updated",
    ]);
    expect((await streamOf(TENANT_ALPHA)).map((e) => e.type)).toEqual([
      "tenant.created",
      DESTRUCTION_REQUESTED_EVENT_QN,
    ]);

    const memberships = await selectMany<{ tenantId: string; id: string }>(
      stack.db,
      tenantMembershipsTable,
      {},
    );
    expect(memberships.map((m) => m.tenantId).sort()).toEqual(
      [MEMBER_TENANT_A, MEMBER_TENANT_B, ALIGNED_TENANT].sort(),
    );
    for (const membership of memberships) {
      const events = await streamOf(membership.id);
      expect(events.map((e) => e.tenantId)).toEqual([membership.tenantId]);
    }

    const rows = await selectMany<{ tenantId: string }>(stack.db, tenantTable, {});
    expect(rows.map((r) => r.tenantId)).toEqual([
      SYSTEM_TENANT_ID,
      SYSTEM_TENANT_ID,
      SYSTEM_TENANT_ID,
    ]);

    expect(await listIds("alpha")).toEqual([TENANT_ALPHA]);
    expect(await searchHits(SESSION_TENANT, "alpha")).toEqual([]);
    expect(await searchHits(FIRST_TENANT, "beta")).toEqual([]);
    expect(await searchHits(SESSION_TENANT, "gamma")).toEqual([]);

    const detail = await stack.http.queryOk<{ version: number; name: string }>(
      DETAIL,
      { id: TENANT_BETA },
      admin,
    );
    await stack.http.writeOk(
      TenantHandlers.update,
      { id: TENANT_BETA, version: detail.version, changes: { name: "Beta Cargo" } },
      admin,
    );
    await stack.http.writeOk(TenantHandlers.disable, { id: TENANT_BETA }, admin);
    await drainEventConsumers(stack, [SEARCH_CONSUMER_NAME]);
    expect(await listIds("cargo")).toEqual([TENANT_BETA]);

    const second = await backfillTenantStreamTenants({
      db: stack.db,
      registry: stack.registry,
      searchAdapter: stack.search,
    });
    expect(second.failures).toEqual([]);
    expect(second.tenants.aggregatesMigrated).toBe(0);
    expect(second.memberships.aggregatesMigrated).toBe(0);
    expect(second.searchDocsRemoved).toBe(0);
  });

  test("a failing search cleanup keeps the tenant on its old stream until the retry succeeds", async () => {
    await seedLegacyEstate();
    const failingAdapter = {
      ...stack.search,
      remove: async (bucket: TenantId, entityType: string, entityId: string) => {
        if (entityId === TENANT_ALPHA) throw new Error("search backend down");
        return stack.search.remove(bucket, entityType, entityId);
      },
      removeBatch: async (
        bucket: TenantId,
        items: readonly { entityType: string; entityId: string }[],
      ) => {
        if (items.some((item) => item.entityId === TENANT_ALPHA)) {
          throw new Error("search backend down");
        }
        return stack.search.removeBatch?.(bucket, items);
      },
    };

    const first = await backfillTenantStreamTenants({
      db: stack.db,
      registry: stack.registry,
      searchAdapter: failingAdapter,
    });
    expect(first.tenants.aggregatesMigrated).toBe(2);
    expect(first.tenants.failed.map((f) => f.aggregateId)).toEqual([TENANT_ALPHA]);
    expect(first.failures.map((f) => f.aggregateId)).toContain(TENANT_ALPHA);
    expect((await streamOf(TENANT_ALPHA)).map((e) => e.tenantId)).toContain(SESSION_TENANT);
    expect(await searchHits(SESSION_TENANT, "alpha")).toEqual([TENANT_ALPHA]);
    for (const id of [TENANT_BETA, TENANT_GAMMA]) {
      expect((await streamOf(id)).map((e) => e.tenantId)).toEqual(
        (await streamOf(id)).map(() => SYSTEM_TENANT_ID),
      );
    }

    const retry = await backfillTenantStreamTenants({
      db: stack.db,
      registry: stack.registry,
      searchAdapter: stack.search,
    });
    expect(retry.failures).toEqual([]);
    expect(retry.tenants.aggregatesMigrated).toBe(1);
    expect((await streamOf(TENANT_ALPHA)).every((e) => e.tenantId === SYSTEM_TENANT_ID)).toBe(true);
    expect(await searchHits(SESSION_TENANT, "alpha")).toEqual([]);
    expect(await listIds("alpha")).toEqual([TENANT_ALPHA]);
  });

  test("runs without a search adapter", async () => {
    await legacyCreateTenant(SESSION_TENANT, TENANT_ALPHA, "alpha", "Alpha Freight");
    const result = await backfillTenantStreamTenants({ db: stack.db, registry: stack.registry });
    expect(result.failures).toEqual([]);
    expect(result.tenants.aggregatesMigrated).toBe(1);
    expect(result.reindexedTenants).toBe(0);
    expect((await streamOf(TENANT_ALPHA)).map((e) => e.tenantId)).toEqual([SYSTEM_TENANT_ID]);
  });
});

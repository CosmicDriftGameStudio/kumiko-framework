// Boot step that moves legacy tenant/membership/user streams: marker short-circuit, crash
// recovery through the derived-pending row, and the session lock between parallel boots.
// Legacy streams are written through the real executor over a tenant entity copy without
// systemStream/tenancy.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  configValuesTable,
  createConfigFeature,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { backfillAggregateStreamTenants } from "@cosmicdrift/kumiko-bundled-features/shared/stream-tenant-backfill";
import {
  createTenantFeature,
  TenantHandlers,
  tenantEntity,
  tenantMembershipEntity,
  tenantMembershipsTable,
  tenantTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import {
  createUserFeature,
  userEntity,
  userTable,
} from "@cosmicdrift/kumiko-bundled-features/user";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import {
  createEventStoreExecutor,
  createTenantDb,
  fetchOne,
  insertOne,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEsOperationsTable, esOperationsTable } from "@cosmicdrift/kumiko-framework/es-ops";
import { append, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
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
import {
  runStreamTenantBackfillOnBoot,
  streamBackfillPendingId,
} from "../stream-tenant-backfill-on-boot";

const SESSION_TENANT = testTenantId(7);
const FIRST_TENANT = testTenantId(1);
const MEMBER_TENANT_A = testTenantId(31);
const MEMBER_TENANT_B = testTenantId(32);
const TENANT_ALPHA = testTenantId(41);
const TENANT_BETA = testTenantId(42);
const TENANT_GAMMA = testTenantId(43);
const TENANT_CANARY = testTenantId(44);
const TENANT_ORPHAN = testTenantId(45);
const ORPHAN_ACTOR_TENANT = testTenantId(99);
const BROKEN_MEMBERSHIP_ID = testTenantId(77);
const TENANT_DELTA = testTenantId(47);
const LEGACY_STREAMS = 5; // three tenants, two memberships

const { systemStream: _systemStream, tenancy: _tenancy, ...legacyTenantEntity } = tenantEntity;
const legacyTenantExecutor = createEventStoreExecutor(tenantTable, legacyTenantEntity, {
  entityName: "tenant",
});
const membershipExecutor = createEventStoreExecutor(
  tenantMembershipsTable,
  tenantMembershipEntity,
  { entityName: "tenant-membership" },
);

const admin: SessionUser = { ...TestUsers.systemAdmin, tenantId: SESSION_TENANT };
const DETAIL = "tenant:query:tenant:detail";

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
  await createEsOperationsTable(stack.db);
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    userTable,
    tenantMembershipsTable,
    tenantTable,
    eventsTable,
    esOperationsTable,
  ]);
  await stack.search.dropAllIndexes?.();
  resetPiiSubjectKmsForTests();
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  resetPiiSubjectKmsForTests();
  await stack.cleanup();
});

function runStep(
  opts: { withAdapter?: boolean; log?: ReturnType<typeof createFallbackLogger> } = {},
) {
  return runStreamTenantBackfillOnBoot({
    db: stack.db,
    registry: stack.registry,
    extraContext: opts.withAdapter === false ? {} : { searchAdapter: stack.search },
    processName: "stream-backfill-test",
    ...(opts.log && { log: opts.log }),
  });
}

function recordingLogger(): {
  log: ReturnType<typeof createFallbackLogger>;
  warnings: string[];
} {
  const warnings: string[] = [];
  const log = createFallbackLogger("stream-backfill-test", {
    error: () => undefined,
    info: () => undefined,
    warn: (message: string) => {
      warnings.push(message);
    },
  });
  return { log, warnings };
}

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

async function seedLegacyEstate(): Promise<void> {
  await legacyCreateTenant(SESSION_TENANT, TENANT_ALPHA, "alpha", "Alpha Freight");
  await legacyCreateTenant(FIRST_TENANT, TENANT_BETA, "beta", "Beta Freight");
  await legacyCreateTenant(SESSION_TENANT, TENANT_GAMMA, "gamma", "Gamma Freight");
  await legacyCreateMembership(SESSION_TENANT, MEMBER_TENANT_A, TestUsers.user.id);
  await legacyCreateMembership(FIRST_TENANT, MEMBER_TENANT_B, TestUsers.user.id);
  await drainEventConsumers(stack, [SEARCH_CONSUMER_NAME]);
}

async function streamTenants(aggregateId: string): Promise<string[]> {
  const rows = await selectMany<{ tenantId: string }>(stack.db, eventsTable, { aggregateId });
  return rows.map((row) => row.tenantId);
}

async function createdPayloadOf(
  aggregateId: string,
  key: string,
  name: string,
): Promise<Record<string, unknown>> {
  const rows = await selectMany<{ payload: Record<string, unknown>; type: string }>(
    stack.db,
    eventsTable,
    { aggregateId },
  );
  const created = rows.find((row) => row.type === "tenant.created");
  if (!created) throw new Error("template tenant.created event missing");
  return { ...created.payload, key, name };
}

async function tenantRowTenants(): Promise<string[]> {
  const rows = await selectMany<{ tenantId: string }>(stack.db, tenantTable, {});
  return rows.map((row) => row.tenantId);
}

async function searchHits(bucket: TenantId, term: string): Promise<string[]> {
  const hits = await stack.search.search(bucket, term, { filterType: "tenant" });
  return hits.map((hit) => String(hit.entityId));
}

async function operationIds(): Promise<string[]> {
  const rows = await selectMany<{ id: string }>(stack.db, esOperationsTable, {});
  return rows.map((row) => row.id).sort();
}

describe("runStreamTenantBackfillOnBoot", () => {
  test("moves everything, fixes legacy streams written later, and does nothing when none are left", async () => {
    await seedLegacyEstate();

    const first = await runStep();
    expect(first.tenant).toBe("completed");
    expect(first.user).toBe("completed");
    expect(first.aggregatesMigrated).toBe(LEGACY_STREAMS);
    expect(await tenantRowTenants()).toEqual(Array(3).fill(SYSTEM_TENANT_ID));
    expect(await searchHits(SESSION_TENANT, "alpha")).toEqual([]);
    expect(await operationIds()).toEqual([]);

    // An old pod writes a legacy stream after the first boot: the next boot moves it.
    await legacyCreateTenant(SESSION_TENANT, TENANT_CANARY, "canary", "Canary Freight");
    const second = await runStep();
    expect(second.aggregatesMigrated).toBe(1);
    expect(await streamTenants(TENANT_CANARY)).toEqual([SYSTEM_TENANT_ID]);
    expect(await tenantRowTenants()).toHaveLength(4);

    // Nothing left: no move and no rebuild (a SYSTEM-stream event stays unprojected).
    await append(stack.db, {
      aggregateId: TENANT_ORPHAN,
      aggregateType: "tenant",
      tenantId: SYSTEM_TENANT_ID,
      expectedVersion: 0,
      type: "tenant.created",
      payload: await createdPayloadOf(TENANT_ALPHA, "late", "Late Freight"),
      metadata: { userId: "test-legacy" },
    });
    const third = await runStep();
    expect(third.aggregatesMigrated).toBe(0);
    expect(await tenantRowTenants()).toHaveLength(4);
    expect(await operationIds()).toEqual([]);
  });

  test("a crash after the moves is repaired through the derived-pending row", async () => {
    await seedLegacyEstate();
    expect(await searchHits(SESSION_TENANT, "alpha")).toEqual([TENANT_ALPHA]);

    // Crashed run: search docs cleaned and streams moved, but no rebuild or reindex yet.
    const moved = await backfillAggregateStreamTenants(stack.db, {
      aggregateType: "tenant",
      target: { kind: "system" },
      beforeMove: async (candidate) => {
        for (const source of candidate.sourceTenantIds) {
          await stack.search.remove(source as TenantId, "tenant", candidate.aggregateId);
        }
      },
    });
    expect(moved.aggregatesMigrated).toBe(3);
    await insertOne(stack.db, esOperationsTable, {
      id: streamBackfillPendingId("tenant"),
      operationType: "stream-migration",
      durationMs: 0,
      appliedBy: "boot",
    });
    expect(await tenantRowTenants()).not.toEqual(Array(3).fill(SYSTEM_TENANT_ID));
    expect(await searchHits(SYSTEM_TENANT_ID, "alpha")).toEqual([]);

    const outcome = await runStep();

    // Only the two memberships still had to move; the pending row makes the step rebuild and
    // reindex the already moved tenants anyway.
    expect(outcome.tenant).toBe("completed");
    expect(outcome.aggregatesMigrated).toBe(2);
    expect(await tenantRowTenants()).toEqual(Array(3).fill(SYSTEM_TENANT_ID));
    expect(await searchHits(SYSTEM_TENANT_ID, "alpha")).toEqual([TENANT_ALPHA]);
    expect(await searchHits(SESSION_TENANT, "alpha")).toEqual([]);
    expect(await searchHits(FIRST_TENANT, "beta")).toEqual([]);
    expect(await operationIds()).toEqual([]);
    expect(
      await fetchOne(stack.db, esOperationsTable, { id: streamBackfillPendingId("tenant") }),
    ).toBe(undefined);
  });

  test("two parallel boots: the lock serializes them, the second finds nothing left", async () => {
    await seedLegacyEstate();

    const [a, b] = await Promise.all([runStep(), runStep()]);

    expect(a.aggregatesMigrated + b.aggregatesMigrated).toBe(LEGACY_STREAMS);
    expect([a.aggregatesMigrated, b.aggregatesMigrated].sort()).toEqual([0, LEGACY_STREAMS]);
    for (const outcome of [a, b]) {
      expect(outcome.tenant === "failed" || outcome.user === "failed").toBe(false);
    }
    expect(await tenantRowTenants()).toEqual(Array(3).fill(SYSTEM_TENANT_ID));
    expect(await operationIds()).toEqual([]);
  });

  test("a legacy stream on a tenant id that has no tenant row and no row carrying it is found", async () => {
    await legacyCreateTenant(SESSION_TENANT, TENANT_ALPHA, "alpha", "Alpha Freight");
    // Appended without a read row: the event itself is the only trace of the actor tenant.
    await append(stack.db, {
      aggregateId: TENANT_ORPHAN,
      aggregateType: "tenant",
      tenantId: ORPHAN_ACTOR_TENANT,
      expectedVersion: 0,
      type: "tenant.created",
      payload: await createdPayloadOf(TENANT_ALPHA, "orphan", "Orphan Freight"),
      metadata: { userId: "test-legacy" },
    });
    expect(await tenantRowTenants()).toEqual([SESSION_TENANT]);
    expect(await streamTenants(TENANT_ORPHAN)).toEqual([ORPHAN_ACTOR_TENANT]);

    const outcome = await runStep();

    expect(outcome.tenant).toBe("completed");
    expect(outcome.aggregatesMigrated).toBe(2);
    expect(await streamTenants(TENANT_ORPHAN)).toEqual([SYSTEM_TENANT_ID]);
    expect(await tenantRowTenants()).toEqual([SYSTEM_TENANT_ID, SYSTEM_TENANT_ID]);
  });

  test("an aggregate that keeps failing does not keep the derived steps running on every boot", async () => {
    await seedLegacyEstate();
    const templatePayload = await createdPayloadOf(TENANT_ALPHA, "late", "Late Freight");
    // A membership stream whose earliest event carries no payload tenantId can never move.
    await append(stack.db, {
      aggregateId: BROKEN_MEMBERSHIP_ID,
      aggregateType: "tenant-membership",
      tenantId: SESSION_TENANT,
      expectedVersion: 0,
      type: "tenant-membership.noted",
      payload: {},
      metadata: { userId: "test-legacy" },
    });

    const first = await runStep();
    expect(first.tenant).toBe("failed");
    expect(await tenantRowTenants()).toEqual(Array(3).fill(SYSTEM_TENANT_ID));
    expect(await operationIds()).toEqual([]);

    // A rebuild on the next boot would project this SYSTEM-stream tenant into a read row.
    await append(stack.db, {
      aggregateId: TENANT_CANARY,
      aggregateType: "tenant",
      tenantId: SYSTEM_TENANT_ID,
      expectedVersion: 0,
      type: "tenant.created",
      payload: { ...templatePayload, id: TENANT_CANARY, key: "late" },
      metadata: { userId: "test-legacy" },
    });

    const second = await runStep();
    expect(second.tenant).toBe("failed");
    expect(second.aggregatesMigrated).toBe(0);
    expect(await tenantRowTenants()).toHaveLength(3);
    expect(await operationIds()).toEqual([]);
  });

  test("without a search adapter the step warns only when there is work, and writes nothing", async () => {
    const clean = recordingLogger();
    const idle = await runStep({ withAdapter: false, log: clean.log });
    expect(idle.tenant).toBe("completed");
    expect(clean.warnings).toEqual([]);
    expect(await operationIds()).toEqual([]);

    await seedLegacyEstate();
    const blocked = recordingLogger();
    const outcome = await runStep({ withAdapter: false, log: blocked.log });
    expect(outcome.tenant).toBe("no-search-adapter");
    expect(blocked.warnings.length).toBeGreaterThan(0);
    expect(await streamTenants(TENANT_ALPHA)).toEqual([SESSION_TENANT]);
    expect(await operationIds()).toEqual([]);

    expect((await runStep()).aggregatesMigrated).toBe(LEGACY_STREAMS);
  });

  test("a split stream (legacy v1 on the session tenant, later events on SYSTEM) is merged in event order", async () => {
    await runStep();
    await legacyCreateTenant(SESSION_TENANT, TENANT_DELTA, "delta", "Delta Freight");
    await drainEventConsumers(stack, [SEARCH_CONSUMER_NAME]);
    await stack.http.writeOk(TenantHandlers.disable, { id: TENANT_DELTA }, admin);
    expect(new Set(await streamTenants(TENANT_DELTA))).toEqual(
      new Set([SESSION_TENANT, SYSTEM_TENANT_ID]),
    );
    expect(await searchHits(SESSION_TENANT, "delta")).toEqual([TENANT_DELTA]);

    const outcome = await runStep();

    expect(outcome.aggregatesMigrated).toBe(1);
    const events = await selectMany<{ id: bigint; tenantId: string; version: number }>(
      stack.db,
      eventsTable,
      { aggregateId: TENANT_DELTA },
    );
    const ordered = [...events].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(ordered.map((e) => e.tenantId)).toEqual(ordered.map(() => SYSTEM_TENANT_ID));
    expect(ordered.map((e) => e.version)).toEqual(ordered.map((_, i) => i + 1));
    const detail = await stack.http.queryOk<{ isEnabled: boolean; version: number }>(
      DETAIL,
      { id: TENANT_DELTA },
      admin,
    );
    expect(detail.isEnabled).toBe(false);
    expect(detail.version).toBe(ordered.length);
    expect(await searchHits(SESSION_TENANT, "delta")).toEqual([]);
    expect(await operationIds()).toEqual([]);
  });
});

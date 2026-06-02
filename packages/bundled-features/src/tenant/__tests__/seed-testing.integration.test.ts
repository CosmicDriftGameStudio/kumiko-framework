// Test for the seedTenantMembership test-helper itself. Test-helpers that
// other tests rely on for fixture setup should themselves have coverage —
// otherwise a silent regression (e.g. the helper stops writing events but
// keeps writing the projection) leaves every downstream test falsely
// passing on bogus state.
//
// Four invariants matter:
//   1. The projection row lands with the right (userId, tenantId, roles).
//   2. A `tenantMembership.created` event lands on the aggregate stream.
//   3. Duplicate call is a no-op (no second event, no crash).
//   4. The `by`-user shows up as insertedById on the projection — so
//      audit-queries that join events→users actually find the actor.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createConfigFeature } from "../../config/feature";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createTenantFeature } from "../feature";
import { tenantMembershipsTable } from "../membership-table";
import { tenantEntity, tenantTable } from "../schema/tenant";
import { seedTenant, seedTenantMembership } from "../seeding";

let stack: TestStack;

const ALICE_ID = "11111111-0000-4000-8000-000000000aaa";
const TENANT_A: TenantId = "00000000-0000-4000-8000-000000000aaa" as TenantId;
const TENANT_B: TenantId = "00000000-0000-4000-8000-000000000bbb" as TenantId;

beforeAll(async () => {
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [createConfigFeature(), createTenantFeature()],
    extraContext: { configResolver: resolver },
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantTable.tableName}"`);
  // Events stay — the idempotency test below inspects how many .created
  // events exist for the same aggregate-key pair across runs.
  await asRawClient(stack.db).unsafe(`DELETE FROM "${eventsTable.tableName}"`);
});

describe("seedTenant", () => {
  test("schreibt Projection-Row mit id/key/name", async () => {
    const { id } = await seedTenant(stack.db, {
      id: TENANT_A,
      key: "tenant-a",
      name: "Tenant A",
    });
    expect(id).toBe(TENANT_A);

    const rows = await selectMany(stack.db, tenantTable, { id: TENANT_A });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["id"]).toBe(TENANT_A);
    expect(rows[0]?.["key"]).toBe("tenant-a");
    expect(rows[0]?.["name"]).toBe("Tenant A");
  });

  test("emittiert tenant.created-Event auf den Aggregate-Stream", async () => {
    await seedTenant(stack.db, { id: TENANT_A, key: "tenant-a", name: "Tenant A" });
    const events = await selectMany(stack.db, eventsTable, { aggregateType: "tenant" });
    const createdEvents = events.filter((e) => e.type === "tenant.created");
    expect(createdEvents).toHaveLength(1);
    // Aggregate-id steht im event-row (aggregateId), nicht im payload —
    // payload trägt die Aggregat-Felder ohne PK.
    expect(createdEvents[0]?.aggregateId).toBe(TENANT_A);
    const payload = createdEvents[0]?.payload as { key: string; name: string };
    expect(payload.key).toBe("tenant-a");
    expect(payload.name).toBe("Tenant A");
  });

  test("zweiter Aufruf für dieselbe id: no-op (kein zweites Event, kein Crash)", async () => {
    await seedTenant(stack.db, { id: TENANT_A, key: "tenant-a", name: "Tenant A" });
    await seedTenant(stack.db, { id: TENANT_A, key: "tenant-a", name: "Tenant A v2" });

    // Projection bleibt bei Original-name (zweiter Call wurde geskippt, kein update).
    const rows = await selectMany(stack.db, tenantTable, { id: TENANT_A });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["name"]).toBe("Tenant A");

    const events = await selectMany(stack.db, eventsTable, { aggregateType: "tenant" });
    expect(events.filter((e) => e.type === "tenant.created")).toHaveLength(1);
  });

  test("zwei verschiedene Tenants in einem Test — beide in der Projection", async () => {
    await seedTenant(stack.db, { id: TENANT_A, key: "a", name: "A" });
    await seedTenant(stack.db, { id: TENANT_B, key: "b", name: "B" });
    const rows = await selectMany(stack.db, tenantTable);
    expect(rows.map((r) => r["id"]).sort()).toEqual([TENANT_A, TENANT_B].sort());
  });
});

describe("seedTenantMembership", () => {
  test("writes the projection row with the given userId / tenantId / roles", async () => {
    await seedTenantMembership(stack.db, {
      userId: ALICE_ID,
      tenantId: TENANT_A,
      roles: ["Admin", "Billing"],
    });

    const rows = await selectMany(stack.db, tenantMembershipsTable, {
      userId: ALICE_ID,
      tenantId: TENANT_A,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["userId"]).toBe(ALICE_ID);
    expect(rows[0]?.["tenantId"]).toBe(TENANT_A);
    expect(rows[0]?.["roles"]).toBe(JSON.stringify(["Admin", "Billing"]));
  });

  test("writes a tenantMembership.created event on the aggregate stream", async () => {
    await seedTenantMembership(stack.db, {
      userId: ALICE_ID,
      tenantId: TENANT_A,
      roles: ["User"],
    });

    const events = await selectMany(stack.db, eventsTable, { aggregateType: "tenant-membership" });
    const createdEvents = events.filter((e) => e.type === "tenant-membership.created");
    expect(createdEvents).toHaveLength(1);
    // Payload should carry the seeded data — MSPs/audit rely on this.
    const payload = createdEvents[0]?.payload as {
      userId: string;
      tenantId: string;
      roles: string;
    };
    expect(payload.userId).toBe(ALICE_ID);
    expect(payload.tenantId).toBe(TENANT_A);
    expect(payload.roles).toBe(JSON.stringify(["User"]));
  });

  test("calling twice for the same (userId, tenantId) is idempotent — no second event, no crash", async () => {
    // First call: creates both projection row + event.
    await seedTenantMembership(stack.db, {
      userId: ALICE_ID,
      tenantId: TENANT_A,
      roles: ["User"],
    });
    // Second call: helper detects existing row and no-ops. Would otherwise
    // trip the (user_id, tenant_id) unique index AND would bump the event
    // count — both are footguns for beforeEach-resets that only clear some
    // tables.
    await seedTenantMembership(stack.db, {
      userId: ALICE_ID,
      tenantId: TENANT_A,
      roles: ["User"],
    });

    const projectionRows = await selectMany(stack.db, tenantMembershipsTable, { userId: ALICE_ID });
    expect(projectionRows).toHaveLength(1);

    const events = await selectMany(stack.db, eventsTable, { aggregateType: "tenant-membership" });
    expect(events.filter((e) => e.type === "tenant-membership.created")).toHaveLength(1);
  });

  test("returns the membership-row id — identical across create + no-op re-seed", async () => {
    // Both return paths (create via extractMembershipId, no-op via fetched row)
    // must yield the same valid uuid string that the projection actually holds.
    // Previously the return was never asserted; a no-op returning the wrong /
    // undefined id would have gone unnoticed.
    const created = await seedTenantMembership(stack.db, {
      userId: ALICE_ID,
      tenantId: TENANT_A,
      roles: ["User"],
    });
    const reSeeded = await seedTenantMembership(stack.db, {
      userId: ALICE_ID,
      tenantId: TENANT_A,
      roles: ["User"],
    });

    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(reSeeded.id).toBe(created.id);

    const [row] = await selectMany(stack.db, tenantMembershipsTable, {
      userId: ALICE_ID,
      tenantId: TENANT_A,
    });
    expect(row?.["id"]).toBe(created.id);
  });

  test("records the `by` user as insertedById on the projection", async () => {
    // Audit-queries that join events → users need a stable actor. Default
    // `by` is TestUsers.systemAdmin; override to a custom test user and
    // assert it propagates to the projection's inserted_by_id column.
    const seedActor = createTestUser({ id: 99, tenantId: TENANT_A });
    await seedTenantMembership(stack.db, {
      userId: ALICE_ID,
      tenantId: TENANT_A,
      roles: ["User"],
      by: seedActor,
    });

    const [row] = await selectMany(stack.db, tenantMembershipsTable, { userId: ALICE_ID });
    expect(row?.["insertedById"]).toBe(seedActor.id);
  });

  test("default `by` is TestUsers.systemAdmin", async () => {
    // Documents the fallback — a regression that changed the default would
    // silently skew audit queries across 18 call-sites.
    await seedTenantMembership(stack.db, {
      userId: ALICE_ID,
      tenantId: TENANT_A,
      roles: ["User"],
    });
    const [row] = await selectMany(stack.db, tenantMembershipsTable, { userId: ALICE_ID });
    expect(row?.["insertedById"]).toBe(TestUsers.systemAdmin.id);
  });
});

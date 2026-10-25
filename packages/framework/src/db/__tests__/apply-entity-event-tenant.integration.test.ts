// Direct tests for applyEntityEvent's tenantId defaulting. Two
// branches (see apply-entity-event.ts:created):
//
//   - payload.tenantId SET → wins (for example, the
//     seedTenantMembership path where the operator and target tenantIds
//     differ)
//   - payload.tenantId NOT SET → falls back to event.tenantId
//     (replay case for entity tables without a tenantId field)
//
// Both branches are indirectly covered by other tests
// (seedTenantMembership integration for A, Live==Rebuild for B), but
// no explicit test pins down applyEntityEvent's exact behavior.
// If someone reverses the spread order in the values() object
// (`...event.payload, tenantId: event.tenantId` instead of
// `tenantId: event.tenantId, ...event.payload`), branch A would silently
// break—the existing seed test would be the only catcher, and it happened
// to pass before the refactor.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, selectMany } from "../../db/query.ts";
import { createEntity, createTextField } from "../../engine/factories.ts";
import type { TenantId } from "../../engine/types/index.ts";
import type { StoredEvent } from "../../event-store/index.ts";
import { ensureTemporalPolyfill } from "../../time/polyfill.ts";
import { applyEntityEvent } from "../apply-entity-event.ts";
import { buildEntityTable } from "../table-builder.ts";
import { withExecutorManagedWrites } from "../tenant-db.ts";
import { type BunTestDb, createTestDb } from "./query/bun-test-db.ts";

const entity = createEntity({
  table: "read_apply_tenant_check",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
});
const table = buildEntityTable("apply-tenant-check", entity);

let testDb: BunTestDb;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await asRawClient(testDb.db).unsafe(`
    CREATE TABLE read_apply_tenant_check (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL,
      version integer NOT NULL DEFAULT 1,
      inserted_at timestamptz NOT NULL DEFAULT now(),
      modified_at timestamptz,
      inserted_by_id text,
      modified_by_id text,
      name text NOT NULL
    )
  `);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(`TRUNCATE read_apply_tenant_check`);
});

const TENANT_OPERATOR = "11111111-1111-1111-1111-111111111111" as TenantId;
const TENANT_TARGET = "22222222-2222-2222-2222-222222222222" as TenantId;

function syntheticCreateEvent(payload: Record<string, unknown>): StoredEvent {
  return {
    id: "evt-1",
    aggregateId: "33333333-3333-3333-3333-333333333333",
    aggregateType: "apply-tenant-check",
    tenantId: TENANT_OPERATOR,
    version: 1,
    type: "apply-tenant-check.created",
    eventVersion: 1,
    payload,
    metadata: { userId: "u-1" },
    createdAt: { toString: () => "2026-04-27T00:00:00Z" } as never,
    createdBy: "u-1",
  };
}

describe("applyEntityEvent — tenantId-Defaulting", () => {
  test("payload WITHOUT tenantId → row.tenantId falls back to event.tenantId (Replay default)", async () => {
    const event = syntheticCreateEvent({ name: "without-tenantId-in-payload" });
    const result = await applyEntityEvent(
      event,
      table,
      entity,
      withExecutorManagedWrites(testDb.db),
    );
    expect(result.kind).toBe("applied");

    const [row] = await selectMany(testDb.db, table, { id: event.aggregateId });
    expect(row?.["tenantId"]).toBe(TENANT_OPERATOR);
    expect(row?.["name"]).toBe("without-tenantId-in-payload");
  });

  test("payload WITH tenantId overrides event.tenantId (seed override case)", async () => {
    // seedTenantMembership reality: the operator (event.tenantId =
    // OPERATOR) writes a membership in the target tenant (payload
    // .tenantId = TARGET). The row belongs to the target tenant.
    const event = syntheticCreateEvent({
      name: "tenantId-override",
      tenantId: TENANT_TARGET,
    });
    const result = await applyEntityEvent(
      event,
      table,
      entity,
      withExecutorManagedWrites(testDb.db),
    );
    expect(result.kind).toBe("applied");

    const [row] = await selectMany(testDb.db, table, { id: event.aggregateId });
    expect(row?.["tenantId"]).toBe(TENANT_TARGET);
    expect(row?.["tenantId"]).not.toBe(TENANT_OPERATOR);
  });

  test("payload.tenantId === '' (empty string) → throws (fail-loud, no silent fallback)", async () => {
    // Critical for tenant isolation: silently falling back to event.tenantId
    // would write a bug payload (form input without a trim check, broken
    // hook, etc.) to the operator tenant, even though the caller code
    // intended to route the row to some target tenant.
    // This causes cross-tenant drift, so failing loudly is the only choice.
    const event = syntheticCreateEvent({
      name: "empty-tenantId",
      tenantId: "",
    });
    await expect(
      applyEntityEvent(event, table, entity, withExecutorManagedWrites(testDb.db)),
    ).rejects.toThrow(/payload\.tenantId set but invalid/);
  });

  test("payload.tenantId === null → wirft (fail-loud)", async () => {
    // Mirror case. A JSON payload can contain literal null (for example, a
    // hook set the value to null instead of unsetting it). There must be
    // no silent fallback here either—this is critical for tenant isolation.
    const event = syntheticCreateEvent({
      name: "null-tenantId",
      tenantId: null,
    });
    await expect(
      applyEntityEvent(event, table, entity, withExecutorManagedWrites(testDb.db)),
    ).rejects.toThrow(/payload\.tenantId set but invalid/);
  });

  test("Spread order: payload fields remain intact, framework defaults are not overwritten", async () => {
    // Negative anchor: id/version/insertedAt/insertedById must NOT come
    // from the payload; they come from the event. Reversing the order in
    // values() would make this test fail.
    const event = syntheticCreateEvent({
      name: "spread-order-check",
      // These payload fields must be overridden by the framework:
      id: "00000000-0000-0000-0000-000000000000",
      version: 999,
      insertedById: "fake-user",
    });
    const result = await applyEntityEvent(
      event,
      table,
      entity,
      withExecutorManagedWrites(testDb.db),
    );
    expect(result.kind).toBe("applied");

    const [row] = await selectMany(testDb.db, table, { id: event.aggregateId });
    // event.aggregateId wins over payload.id
    expect(row?.["id"]).toBe(event.aggregateId);
    // event.version wins over payload.version
    expect(row?.["version"]).toBe(event.version);
    // event.createdBy wins over payload.insertedById
    expect(row?.["insertedById"]).toBe(event.createdBy);
  });
});

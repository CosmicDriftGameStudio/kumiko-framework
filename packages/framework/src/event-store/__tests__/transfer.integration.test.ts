// transferAggregateStreams — the event store's own tenant-transfer primitive.
// Pins: events, snapshots and the archive marker all move together; a system
// aggregate.transferred event lands per moved aggregate; an empty id list is
// a no-op; an id with no events under the given tenant/aggregateType is left
// untouched; an aggregate belonging to an unrelated third tenant is never
// touched by another tenant's move; an archive marker for a DIFFERENT
// aggregate type sharing the same aggregate id stays behind.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db.js";
import { asRawClient } from "../../db/query.js";
import type { TenantId } from "../../engine/types/index.js";
import { ensureTemporalPolyfill } from "../../time/polyfill.js";
import { generateId as uuid } from "../../utils/index.js";
import {
  AGGREGATE_TRANSFER_STREAM_TYPE,
  AGGREGATE_TRANSFERRED_EVENT_TYPE,
  append,
  archiveStream,
  isStreamArchived,
  loadAggregate,
  loadLatestSnapshot,
  saveSnapshot,
  transferAggregateStreams,
} from "../index.js";

let bun: BunTestDb;
const sourceTenant = uuid() as TenantId;
const destinationTenant = uuid() as TenantId;
const otherTenant = uuid() as TenantId;
const userId = uuid();
const transferredBy = uuid();

beforeAll(async () => {
  await ensureTemporalPolyfill();
  bun = await createTestDb();
});

afterAll(async () => {
  await bun.cleanup();
});

beforeEach(async () => {
  await asRawClient(bun.db).unsafe(
    `TRUNCATE kumiko_events, kumiko_snapshots, kumiko_archived_streams RESTART IDENTITY`,
  );
});

async function seedAggregate(tenantId: TenantId, aggregateType = "counter"): Promise<string> {
  const aggregateId = uuid();
  await append(bun.db, {
    aggregateId,
    aggregateType,
    tenantId,
    expectedVersion: 0,
    type: "counter.incremented",
    payload: { by: 1 },
    metadata: { userId },
  });
  return aggregateId;
}

// Each `aggregate.transferred` event lives on its OWN fresh stream (see
// transfer.ts) — the row's own `aggregate_id` column is that stream's id,
// not the moved aggregate's. The moved aggregate's id is in the payload.
async function transferredEvents(tenantId: TenantId): Promise<readonly Record<string, unknown>[]> {
  const rows = (await asRawClient(bun.db).unsafe(
    `SELECT payload FROM kumiko_events WHERE tenant_id = $1 AND aggregate_type = $2 AND type = $3`,
    [tenantId, AGGREGATE_TRANSFER_STREAM_TYPE, AGGREGATE_TRANSFERRED_EVENT_TYPE],
  )) as ReadonlyArray<{ payload: Record<string, unknown> }>;
  return rows.map((row) => row.payload);
}

describe("transferAggregateStreams", () => {
  test("moves events, drops the snapshot, carries the archive marker, and emits one aggregate.transferred event per moved aggregate", async () => {
    const first = await seedAggregate(sourceTenant);
    const second = await seedAggregate(sourceTenant);
    await saveSnapshot(bun.db, {
      aggregateId: first,
      tenantId: sourceTenant,
      aggregateType: "counter",
      version: 1,
      state: { count: 1 },
    });
    await archiveStream(bun.db, {
      tenantId: sourceTenant,
      aggregateId: first,
      aggregateType: "counter",
      archivedBy: "ops",
    });

    const movedCount = await transferAggregateStreams(bun.db, {
      sourceTenantId: sourceTenant,
      destinationTenantId: destinationTenant,
      aggregateType: "counter",
      aggregateIds: [first, second],
      transferredBy,
    });
    expect(movedCount).toBe(2);

    // Events: gone from the source tenant, present under the destination.
    expect(
      await loadAggregate(bun.db, first, sourceTenant, { includeArchived: true }),
    ).toHaveLength(0);
    expect(await loadAggregate(bun.db, second, sourceTenant)).toHaveLength(0);
    const firstEvents = await loadAggregate(bun.db, first, destinationTenant, {
      includeArchived: true,
    });
    expect(firstEvents.some((e) => e.type === "counter.incremented")).toBe(true);
    const secondEvents = await loadAggregate(bun.db, second, destinationTenant);
    expect(secondEvents.some((e) => e.type === "counter.incremented")).toBe(true);

    // Snapshot dropped from the source tenant, not recreated anywhere.
    expect(await loadLatestSnapshot(bun.db, first, sourceTenant)).toBeNull();
    expect(await loadLatestSnapshot(bun.db, first, destinationTenant)).toBeNull();

    // Archive marker moved with the stream.
    expect(await isStreamArchived(bun.db, sourceTenant, first)).toBe(false);
    expect(await isStreamArchived(bun.db, destinationTenant, first)).toBe(true);
    expect(await isStreamArchived(bun.db, destinationTenant, second)).toBe(false);

    // One system event per moved aggregate, in the destination tenant.
    const events = await transferredEvents(destinationTenant);
    expect(events).toHaveLength(2);
    const byAggregateId = new Map(events.map((payload) => [payload["aggregateId"], payload]));
    expect(byAggregateId.get(first)).toMatchObject({
      aggregateType: "counter",
      aggregateId: first,
      sourceTenantId: sourceTenant,
      destinationTenantId: destinationTenant,
    });
    expect(byAggregateId.get(second)).toMatchObject({
      aggregateType: "counter",
      aggregateId: second,
      sourceTenantId: sourceTenant,
      destinationTenantId: destinationTenant,
    });
  });

  test("an empty id list is a no-op", async () => {
    const movedCount = await transferAggregateStreams(bun.db, {
      sourceTenantId: sourceTenant,
      destinationTenantId: destinationTenant,
      aggregateType: "counter",
      aggregateIds: [],
      transferredBy,
    });
    expect(movedCount).toBe(0);
    expect(await transferredEvents(destinationTenant)).toHaveLength(0);
  });

  test("an id with no events under this tenant/aggregateType is left untouched and gets no event", async () => {
    const untouched = uuid();
    const movedCount = await transferAggregateStreams(bun.db, {
      sourceTenantId: sourceTenant,
      destinationTenantId: destinationTenant,
      aggregateType: "counter",
      aggregateIds: [untouched],
      transferredBy,
    });
    expect(movedCount).toBe(0);
    expect(await loadAggregate(bun.db, untouched, sourceTenant)).toHaveLength(0);
    expect(await loadAggregate(bun.db, untouched, destinationTenant)).toHaveLength(0);
    expect(await transferredEvents(destinationTenant)).toHaveLength(0);
  });

  test("an aggregate under an unrelated third tenant with the same id is untouched", async () => {
    const sharedId = uuid();
    await append(bun.db, {
      aggregateId: sharedId,
      aggregateType: "counter",
      tenantId: otherTenant,
      expectedVersion: 0,
      type: "counter.incremented",
      payload: { by: 1 },
      metadata: { userId },
    });
    await append(bun.db, {
      aggregateId: sharedId,
      aggregateType: "counter",
      tenantId: sourceTenant,
      expectedVersion: 0,
      type: "counter.incremented",
      payload: { by: 1 },
      metadata: { userId },
    });

    await transferAggregateStreams(bun.db, {
      sourceTenantId: sourceTenant,
      destinationTenantId: destinationTenant,
      aggregateType: "counter",
      aggregateIds: [sharedId],
      transferredBy,
    });

    const otherTenantEvents = await loadAggregate(bun.db, sharedId, otherTenant);
    expect(otherTenantEvents).toHaveLength(1);
    expect(await loadAggregate(bun.db, sharedId, sourceTenant)).toHaveLength(0);
  });

  test("an archived marker for a different aggregate type sharing the moved aggregate's id stays in the source tenant", async () => {
    const sharedId = uuid();
    // `append()` shares its version-conflict check across the plain
    // aggregateId, so a real "widget" stream can't coexist with a real
    // "counter" stream under the same id/tenant — fabricate the archived
    // marker directly (the primary verifier of the event-store primitive,
    // same reasoning as guard-event-store-writes' own __tests__ exclusion)
    // to prove the WHERE clause's aggregate_type filter, not the stream's
    // version-numbering.
    await asRawClient(bun.db).unsafe(
      `INSERT INTO "kumiko_archived_streams" ("tenant_id", "aggregate_id", "aggregate_type", "archived_by") VALUES ($1, $2, $3, $4)`,
      [sourceTenant, sharedId, "widget", "ops"],
    );
    await append(bun.db, {
      aggregateId: sharedId,
      aggregateType: "counter",
      tenantId: sourceTenant,
      expectedVersion: 0,
      type: "counter.incremented",
      payload: { by: 1 },
      metadata: { userId },
    });

    const movedCount = await transferAggregateStreams(bun.db, {
      sourceTenantId: sourceTenant,
      destinationTenantId: destinationTenant,
      aggregateType: "counter",
      aggregateIds: [sharedId],
      transferredBy,
    });
    expect(movedCount).toBe(1);

    expect(await isStreamArchived(bun.db, sourceTenant, sharedId)).toBe(true);
    expect(await isStreamArchived(bun.db, destinationTenant, sharedId)).toBe(false);
  });
});

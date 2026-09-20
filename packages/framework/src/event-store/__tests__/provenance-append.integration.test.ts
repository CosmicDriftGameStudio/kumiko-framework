import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db";
import { asRawClient, transaction } from "../../db/query";
import { createTenantDb, type TenantDb } from "../../db/tenant-db";
import { AccessDeniedError, InternalError } from "../../errors";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import { generateId as uuid } from "../../utils";
import { loadAggregate, VersionConflictError } from "../index";
import { appendProvenanceEvent, type ProvenanceEventInput } from "../provenance-append";

let testDb: BunTestDb;
let tdb: TenantDb;

const tenantA = uuid();
const tenantB = uuid();

async function countAllEvents(): Promise<number> {
  const rows = await asRawClient(testDb.db).unsafe<{ n: string }>(
    "SELECT count(*)::text AS n FROM kumiko_events",
  );
  return Number(rows[0]?.n);
}

function provenanceEvent(overrides: Partial<ProvenanceEventInput>): ProvenanceEventInput {
  return {
    aggregateId: uuid(),
    aggregateType: "ai-call",
    tenantId: tenantA,
    expectedVersion: 0,
    type: "ai-foundation:ai-call-recorded",
    payload: { promptVersion: "abc123" },
    metadata: { userId: uuid() },
    ...overrides,
  };
}

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  tdb = createTenantDb(testDb.db, tenantA);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(`TRUNCATE kumiko_events RESTART IDENTITY`);
});

describe("appendProvenanceEvent", () => {
  test("expectedVersion: 0 writes the event, readable via loadAggregate", async () => {
    const event = provenanceEvent({ expectedVersion: 0 });

    await appendProvenanceEvent(tdb, event);

    const events = await loadAggregate(testDb.db, event.aggregateId, tenantA);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(event.type);
    expect(events[0]?.payload).toEqual(event.payload);
  });

  test('expectedVersion: "current" appends twice to the same aggregate without a version conflict', async () => {
    const aggregateId = uuid();

    await appendProvenanceEvent(tdb, provenanceEvent({ aggregateId, expectedVersion: "current" }));
    await appendProvenanceEvent(tdb, provenanceEvent({ aggregateId, expectedVersion: "current" }));

    const events = await loadAggregate(testDb.db, aggregateId, tenantA);
    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("ai-foundation:ai-call-recorded");
    expect(events[1]?.type).toBe("ai-foundation:ai-call-recorded");
  });

  test("a failing append does not poison the surrounding transaction", async () => {
    const aggregateId = uuid();
    await appendProvenanceEvent(tdb, provenanceEvent({ aggregateId, expectedVersion: 0 }));

    await transaction(testDb.db, async (tx) => {
      const txTdb = createTenantDb(tx, tenantA);

      await expect(
        appendProvenanceEvent(txTdb, provenanceEvent({ aggregateId, expectedVersion: 0 })),
      ).rejects.toThrow(VersionConflictError);

      const stillUsable = await asRawClient(tx).unsafe<{ one: number }>("SELECT 1 AS one");
      expect(stillUsable[0]?.one).toBe(1);
    });
  });

  test("a TenantDb not built by createTenantDb fails closed", async () => {
    const handBuilt = { tenantId: tenantA, mode: "tenant" } as unknown as TenantDb;

    await expect(appendProvenanceEvent(handBuilt, provenanceEvent({}))).rejects.toThrow(
      InternalError,
    );
  });

  test("rejects a kumiko:system: type and writes nothing", async () => {
    const event = provenanceEvent({ type: "kumiko:system:deferred-dispatch" });

    await expect(appendProvenanceEvent(tdb, event)).rejects.toThrow(InternalError);

    const events = await loadAggregate(testDb.db, event.aggregateId, tenantA);
    expect(events).toHaveLength(0);
  });

  test("rejects an unqualified type without a ':' and writes nothing", async () => {
    const event = provenanceEvent({ type: "ai-call-recorded" });

    await expect(appendProvenanceEvent(tdb, event)).rejects.toThrow(InternalError);

    const events = await loadAggregate(testDb.db, event.aggregateId, tenantA);
    expect(events).toHaveLength(0);
  });

  test("a foreign event.tenantId is rejected and writes no row at all", async () => {
    const event = provenanceEvent({ tenantId: tenantB });
    const before = await countAllEvents();

    await expect(appendProvenanceEvent(tdb, event)).rejects.toThrow(AccessDeniedError);
    await expect(appendProvenanceEvent(tdb, event)).rejects.toThrow(
      new RegExp(`"${tenantB}".+"${tenantA}"`),
    );

    expect(await countAllEvents()).toBe(before);
    expect(await loadAggregate(testDb.db, event.aggregateId, tenantB)).toHaveLength(0);
  });

  test('a mode: "system" TenantDb is rejected for a foreign event.tenantId too', async () => {
    const systemTdb = createTenantDb(testDb.db, tenantA, "system");
    const event = provenanceEvent({ tenantId: tenantB });
    const before = await countAllEvents();

    await expect(appendProvenanceEvent(systemTdb, event)).rejects.toThrow(AccessDeniedError);

    expect(await countAllEvents()).toBe(before);
    expect(await loadAggregate(testDb.db, event.aggregateId, tenantB)).toHaveLength(0);
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../db/__tests__/query/bun-test-db.ts";
import { transaction } from "../../db/query.ts";
import { createTenantDb, type TenantDb } from "../../db/tenant-db.ts";
import { InternalError } from "../../errors/index.ts";
import { ensureTemporalPolyfill } from "../../time/polyfill.ts";
import { generateId as uuid } from "../../utils/index.ts";
import {
  appendEventInTenantDb,
  getStreamVersionInTenantDb,
  loadAggregate,
  VersionConflictError,
} from "../index.ts";

let testDb: BunTestDb;
let tenantDb: TenantDb;

const tenantA = uuid();
const tenantB = uuid();

function eventFor(aggregateId: string, expectedVersion: number) {
  return {
    aggregateId,
    aggregateType: "probe",
    expectedVersion,
    type: "probe:event:happened",
    payload: { n: expectedVersion },
    metadata: { userId: uuid() },
  };
}

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  tenantDb = createTenantDb({ db: testDb.db, tenantId: tenantA });
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("appendEventInTenantDb", () => {
  test("the event lands in the TenantDb's tenant and the stream version follows it", async () => {
    const aggregateId = uuid();
    expect(await getStreamVersionInTenantDb(tenantDb, aggregateId)).toBe(0);

    const stored = await appendEventInTenantDb(tenantDb, eventFor(aggregateId, 0));
    await appendEventInTenantDb(tenantDb, eventFor(aggregateId, 1));

    expect(stored.tenantId).toBe(tenantA);
    expect(await getStreamVersionInTenantDb(tenantDb, aggregateId)).toBe(2);
    expect(await loadAggregate(testDb.db, aggregateId, tenantA)).toHaveLength(2);
    expect(await loadAggregate(testDb.db, aggregateId, tenantB)).toHaveLength(0);
  });

  test("a stale expectedVersion is a version conflict", async () => {
    const aggregateId = uuid();
    await appendEventInTenantDb(tenantDb, eventFor(aggregateId, 0));

    await expect(appendEventInTenantDb(tenantDb, eventFor(aggregateId, 0))).rejects.toThrow(
      VersionConflictError,
    );
  });

  test("rolls back with the surrounding transaction", async () => {
    const aggregateId = uuid();

    await expect(
      transaction(testDb.db, async (tx) => {
        await appendEventInTenantDb(
          createTenantDb({ db: tx, tenantId: tenantA }),
          eventFor(aggregateId, 0),
        );
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");

    expect(await loadAggregate(testDb.db, aggregateId, tenantA)).toHaveLength(0);
  });

  test("a TenantDb not built by createTenantDb fails closed", async () => {
    const handBuilt = { tenantId: tenantA, mode: "tenant" } as TenantDb; // @cast-boundary test-fixture: not built by createTenantDb

    await expect(appendEventInTenantDb(handBuilt, eventFor(uuid(), 0))).rejects.toThrow(
      InternalError,
    );
    await expect(getStreamVersionInTenantDb(handBuilt, uuid())).rejects.toThrow(InternalError);
  });
});

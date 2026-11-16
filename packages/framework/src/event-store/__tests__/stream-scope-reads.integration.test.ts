import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { testTenantId } from "../../seeding/seed-users.ts";
import { append, loadEventsAfterVersion } from "../event-store.ts";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb({ applicationRole: true });
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("stream reads set their own tenant scope", () => {
  test("loadEventsAfterVersion reads the stream under the application role without an outer tenant scope", async () => {
    const tenant = testTenantId(431);
    const aggregateId = "00000000-0000-4000-8000-000000004311";
    await append(testDb.db, {
      aggregateId,
      aggregateType: "scope-probe",
      tenantId: tenant,
      expectedVersion: 0,
      type: "scope-probe.created",
      payload: {},
      metadata: { userId: "1" },
    });
    await append(testDb.db, {
      aggregateId,
      aggregateType: "scope-probe",
      tenantId: tenant,
      expectedVersion: 1,
      type: "scope-probe.renamed",
      payload: {},
      metadata: { userId: "1" },
    });

    const events = await loadEventsAfterVersion(testDb.db, aggregateId, tenant, 1);

    expect(events.map((e) => e.version)).toEqual([2]);
  });
});

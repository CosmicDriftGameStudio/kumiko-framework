import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db.js";
import { ensureMembershipPayloadTenantIndex } from "../../db/queries/event-store.js";
import { asRawClient } from "../../db/query.js";
import { createEventsTable } from "../events-schema.js";

let testDb: BunTestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  await createEventsTable(testDb.db);
});

afterAll(async () => {
  await testDb.cleanup();
});

async function membershipIndexDefinitions(): Promise<readonly string[]> {
  const rows = (await asRawClient(testDb.db).unsafe(
    `SELECT indexdef FROM pg_indexes WHERE tablename = 'kumiko_events' ` +
      `AND indexname = 'events_membership_payload_tenant_idx'`,
  )) as ReadonlyArray<{ indexdef: string }>;
  return rows.map((row) => row.indexdef);
}

describe("membership payload tenant index", () => {
  test("createEventsTable leaves a partial index over payload tenantId for tenant-membership streams", async () => {
    const [definition, ...rest] = await membershipIndexDefinitions();
    expect(rest).toHaveLength(0);
    expect(definition).toContain("payload");
    expect(definition).toContain("'tenantId'");
    expect(definition).toContain("aggregate_type");
    expect(definition).toContain("tenant-membership");
  });

  test("ensuring it again is a no-op and heals a dropped index", async () => {
    await ensureMembershipPayloadTenantIndex(testDb.db);
    expect(await membershipIndexDefinitions()).toHaveLength(1);

    await asRawClient(testDb.db).unsafe(
      `DROP INDEX CONCURRENTLY IF EXISTS "events_membership_payload_tenant_idx"`,
    );
    await ensureMembershipPayloadTenantIndex(testDb.db);
    expect(await membershipIndexDefinitions()).toHaveLength(1);
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../db/__tests__/query/bun-test-db.ts";
import {
  AGGREGATE_TYPE_ID_INDEX_NAME,
  CREATED_AT_INDEX_NAME,
  ensureSecondaryEventIndexes,
  MEMBERSHIP_PAYLOAD_TENANT_INDEX_NAME,
  MEMBERSHIP_PAYLOAD_USER_INDEX_NAME,
  TENANT_ID_INDEX_NAME,
} from "../../db/queries/event-store.ts";
import { asRawClient } from "../../db/query.ts";
import { createEventsTable } from "../events-schema.ts";

let testDb: BunTestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  await createEventsTable(testDb.db);
});

afterAll(async () => {
  await testDb.cleanup();
});

async function indexDefinitions(indexName: string): Promise<readonly string[]> {
  const rows = (await asRawClient(testDb.db).unsafe(
    `SELECT indexdef FROM pg_indexes WHERE tablename = 'kumiko_events' AND indexname = $1`,
    [indexName],
  )) as ReadonlyArray<{ indexdef: string }>;
  return rows.map((row) => row.indexdef);
}

async function dropIndex(indexName: string): Promise<void> {
  await asRawClient(testDb.db).unsafe(`DROP INDEX CONCURRENTLY IF EXISTS "${indexName}"`);
}

describe("secondary kumiko_events indexes", () => {
  test("createEventsTable leaves a partial index over payload tenantId for tenant-membership streams", async () => {
    const [definition, ...rest] = await indexDefinitions(MEMBERSHIP_PAYLOAD_TENANT_INDEX_NAME);
    expect(rest).toHaveLength(0);
    expect(definition).toContain("payload");
    expect(definition).toContain("'tenantId'");
    expect(definition).toContain("aggregate_type");
    expect(definition).toContain("tenant-membership");
  });

  test("ensuring it again is a no-op and heals a dropped index", async () => {
    await ensureSecondaryEventIndexes(testDb.db);
    expect(await indexDefinitions(MEMBERSHIP_PAYLOAD_TENANT_INDEX_NAME)).toHaveLength(1);

    await dropIndex(MEMBERSHIP_PAYLOAD_TENANT_INDEX_NAME);
    await ensureSecondaryEventIndexes(testDb.db);
    expect(await indexDefinitions(MEMBERSHIP_PAYLOAD_TENANT_INDEX_NAME)).toHaveLength(1);
  });

  test("createEventsTable leaves a partial index over payload userId for tenant-membership streams", async () => {
    const [definition, ...rest] = await indexDefinitions(MEMBERSHIP_PAYLOAD_USER_INDEX_NAME);
    expect(rest).toHaveLength(0);
    expect(definition).toContain("'userId'");
    expect(definition).toContain("tenant-membership");
  });

  test("ensuring again heals a dropped payload userId index", async () => {
    await dropIndex(MEMBERSHIP_PAYLOAD_USER_INDEX_NAME);
    expect(await indexDefinitions(MEMBERSHIP_PAYLOAD_USER_INDEX_NAME)).toHaveLength(0);
    await ensureSecondaryEventIndexes(testDb.db);
    expect(await indexDefinitions(MEMBERSHIP_PAYLOAD_USER_INDEX_NAME)).toHaveLength(1);
  });

  test("createEventsTable leaves a (tenant_id, id) index for the audit list", async () => {
    const [definition, ...rest] = await indexDefinitions(TENANT_ID_INDEX_NAME);
    expect(rest).toHaveLength(0);
    expect(definition).toContain("(tenant_id, id)");
  });

  test("ensuring again heals a dropped tenant id index", async () => {
    await dropIndex(TENANT_ID_INDEX_NAME);
    expect(await indexDefinitions(TENANT_ID_INDEX_NAME)).toHaveLength(0);
    await ensureSecondaryEventIndexes(testDb.db);
    expect(await indexDefinitions(TENANT_ID_INDEX_NAME)).toHaveLength(1);
  });

  test("createEventsTable leaves a created_at index for time-window counts", async () => {
    const [definition, ...rest] = await indexDefinitions(CREATED_AT_INDEX_NAME);
    expect(rest).toHaveLength(0);
    expect(definition).toContain("(created_at)");
  });

  test("ensuring again heals a dropped created_at index", async () => {
    await dropIndex(CREATED_AT_INDEX_NAME);
    expect(await indexDefinitions(CREATED_AT_INDEX_NAME)).toHaveLength(0);
    await ensureSecondaryEventIndexes(testDb.db);
    expect(await indexDefinitions(CREATED_AT_INDEX_NAME)).toHaveLength(1);
  });

  test("createEventsTable leaves an (aggregate_type, id) index for type-wide scans", async () => {
    const [definition, ...rest] = await indexDefinitions(AGGREGATE_TYPE_ID_INDEX_NAME);
    expect(rest).toHaveLength(0);
    expect(definition).toContain("(aggregate_type, id)");
  });

  test("ensuring again heals a dropped aggregate type id index", async () => {
    await dropIndex(AGGREGATE_TYPE_ID_INDEX_NAME);
    expect(await indexDefinitions(AGGREGATE_TYPE_ID_INDEX_NAME)).toHaveLength(0);
    await ensureSecondaryEventIndexes(testDb.db);
    expect(await indexDefinitions(AGGREGATE_TYPE_ID_INDEX_NAME)).toHaveLength(1);
  });
});

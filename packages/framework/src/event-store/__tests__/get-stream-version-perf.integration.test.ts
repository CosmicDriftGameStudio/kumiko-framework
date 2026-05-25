// Block 0 perf probe — getStreamVersion is on the hot write-path: the CRUD
// executor calls it once per update/delete/restore to derive expectedVersion.
// A slow MAX(version) would regress every CRUD write on a hot aggregate.
//
// Claim: indexed lookup (events_aggregate_version_uq on (aggregate_id,
// version)) makes MAX(version) sub-ms even with thousands of events in the
// same stream.
//
// Not a strict SLA test — the threshold is generous enough to survive CI
// noise but tight enough that an index-miss regression would fail loudly.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db";
import { insertMany } from "../../bun-db/query";
import type { TenantId } from "../../engine/types";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import { generateId as uuid } from "../../utils";
import { createEventsTable, eventsTable, getStreamVersion } from "../index";

let testDb: BunTestDb;
const tenantId: TenantId = uuid();
const userId = uuid();

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await createEventsTable(testDb.db);
});

afterAll(async () => {
  await testDb.cleanup();
});

async function seedStream(aggregateId: string, count: number): Promise<void> {
  // Bulk-seed — 2000 sequential append() calls dominate runtime and flake
  // under load. We measure getStreamVersion(), not append latency.
  const rows = Array.from({ length: count }, (_, i) => ({
    aggregateId,
    aggregateType: "perfAgg",
    tenantId,
    version: i + 1,
    type: "perfAgg.created",
    payload: { seq: i },
    metadata: { userId },
    createdBy: userId,
  }));
  await insertMany(testDb.db, eventsTable, rows);
}

describe("event-store: getStreamVersion perf on hot streams", () => {
  test("2000-event stream: MAX(version) stays under 30ms per call (indexed)", async () => {
    const aggregateId = uuid();
    await seedStream(aggregateId, 2000);

    // Warm up — first query parses + plans.
    await getStreamVersion(testDb.db, aggregateId, tenantId);

    // Median of 50 calls to smooth CI noise. Each call is one indexed MAX.
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      const v = await getStreamVersion(testDb.db, aggregateId, tenantId);
      samples.push(performance.now() - start);
      expect(v).toBe(2000);
    }

    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length / 2)] ?? 0;
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;

    // Generous bound for CI — local runs typically see p50 < 1ms, p95 < 5ms.
    // A regression to scan-instead-of-index would push p95 into tens of ms
    // at 2000 rows and get worse linearly.
    expect(p50).toBeLessThan(30);
    expect(p95).toBeLessThan(50);
  });

  test("empty stream: returns 0 without full-table scan", async () => {
    const aggregateId = uuid(); // never seeded
    const start = performance.now();
    const v = await getStreamVersion(testDb.db, aggregateId, tenantId);
    const elapsed = performance.now() - start;

    expect(v).toBe(0);
    // Not a timing claim, just catch an accidental full-scan regression.
    expect(elapsed).toBeLessThan(50);
  });
});

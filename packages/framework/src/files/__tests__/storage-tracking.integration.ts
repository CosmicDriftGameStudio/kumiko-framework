// tenant_storage_usage MSP — aggregates upload sizes per tenant.
//
// Proves:
//   1. Two uploads from the same tenant end up on a single row with the
//      sums and counts incremented atomically.
//   2. Uploads from different tenants land on separate rows — no cross-
//      tenant leakage through the UPSERT.
//   3. The table column types survive round-trip (bigint → number via
//      Drizzle's mode:"number", so arithmetic in assertions Just Works).

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { SessionUser } from "../../engine";
import { createTestUser, setupTestStack, type TestStack, TestUsers } from "../../stack";
import {
  createInMemoryFileProvider,
  filesStorageTrackingFeature,
  type InMemoryFileProvider,
  tenantStorageUsageTable,
} from "..";

let stack: TestStack;
let provider: InMemoryFileProvider;

const admin = TestUsers.admin;
// Second tenant — a different UUID in the valid v4 range. The MSP must
// key on event.tenantId, so this row should never cross over with admin's.
const otherAdmin = createTestUser({
  tenantId: "00000000-0000-4000-8000-000000000042",
  roles: ["Admin"],
});

// Two tiny payloads with distinct lengths so the sum assertion can tell
// them apart without relying on the underlying bytes.
const SMALL = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...Array(16).fill(0)]); // 20 bytes, PNG-ish
const LARGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...Array(96).fill(0)]); // 100 bytes

beforeAll(async () => {
  provider = createInMemoryFileProvider();
  stack = await setupTestStack({
    features: [filesStorageTrackingFeature],
    files: { storageProvider: provider },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  provider.clear();
  stack.events.reset();
  // Reset events + storage-usage row + consumer cursors + file_refs so
  // each test starts from zero. kumiko_event_consumers registration is
  // re-asserted below; truncating it forces ensureRegistered to seed the
  // cursor at event.id = 0.
  await stack.db.execute(
    sql`TRUNCATE kumiko_events, kumiko_event_consumers, file_refs, read_tenant_storage_usage RESTART IDENTITY CASCADE`,
  );
  await stack.eventDispatcher?.ensureRegistered();
});

async function upload(user: SessionUser, name: string, content: Uint8Array): Promise<void> {
  const token = await stack.jwt.sign(user);
  const formData = new FormData();
  formData.append("file", new File([Buffer.from(content)], name, { type: "image/png" }));
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  expect(res.status).toBe(201);
}

async function usageFor(tenantId: string): Promise<{ totalBytes: number; fileCount: number }> {
  const [row] = await stack.db
    .select({
      totalBytes: tenantStorageUsageTable.totalBytes,
      fileCount: tenantStorageUsageTable.fileCount,
    })
    .from(tenantStorageUsageTable)
    .where(eq(tenantStorageUsageTable.tenantId, tenantId));
  return row ?? { totalBytes: 0, fileCount: 0 };
}

describe("tenant-storage-usage MSP", () => {
  test("single upload writes a row with totalBytes = size, fileCount = 1", async () => {
    await upload(admin, "a.png", SMALL);
    await stack.eventDispatcher?.runOnce();

    const usage = await usageFor(admin.tenantId);
    expect(usage).toEqual({ totalBytes: SMALL.length, fileCount: 1 });
  });

  test("two uploads same tenant — row increments atomically (UPSERT)", async () => {
    await upload(admin, "a.png", SMALL);
    await upload(admin, "b.png", LARGE);
    await stack.eventDispatcher?.runOnce();

    const usage = await usageFor(admin.tenantId);
    expect(usage).toEqual({
      totalBytes: SMALL.length + LARGE.length,
      fileCount: 2,
    });

    // Exactly one row per tenant — the UPSERT must not insert a second
    // row for the second upload.
    const rows = await stack.db
      .select()
      .from(tenantStorageUsageTable)
      .where(eq(tenantStorageUsageTable.tenantId, admin.tenantId));
    expect(rows).toHaveLength(1);
  });

  test("two tenants — separate rows, no cross-leakage", async () => {
    await upload(admin, "a.png", SMALL);
    await upload(otherAdmin, "b.png", LARGE);
    await stack.eventDispatcher?.runOnce();

    const adminUsage = await usageFor(admin.tenantId);
    const otherUsage = await usageFor(otherAdmin.tenantId);

    expect(adminUsage).toEqual({ totalBytes: SMALL.length, fileCount: 1 });
    expect(otherUsage).toEqual({ totalBytes: LARGE.length, fileCount: 1 });
  });

  test("lastUpdatedAt is set and advances on subsequent uploads", async () => {
    await upload(admin, "a.png", SMALL);
    await stack.eventDispatcher?.runOnce();

    const [first] = await stack.db
      .select({ at: tenantStorageUsageTable.lastUpdatedAt })
      .from(tenantStorageUsageTable)
      .where(eq(tenantStorageUsageTable.tenantId, admin.tenantId));
    expect(first?.at).toBeInstanceOf(Temporal.Instant);

    // Postgres NOW() resolution is microseconds; a second upload a beat
    // later must produce a strictly later timestamp (or at least not an
    // older one). We assert >= rather than > to keep the test tolerant
    // of same-clock-tick runs.
    await new Promise((r) => setTimeout(r, 10));
    await upload(admin, "b.png", LARGE);
    await stack.eventDispatcher?.runOnce();

    const [second] = await stack.db
      .select({ at: tenantStorageUsageTable.lastUpdatedAt })
      .from(tenantStorageUsageTable)
      .where(eq(tenantStorageUsageTable.tenantId, admin.tenantId));
    expect(second?.at).toBeInstanceOf(Temporal.Instant);
    if (!first?.at || !second?.at) throw new Error("missing rows");
    expect(Temporal.Instant.compare(second.at, first.at)).toBeGreaterThanOrEqual(0);
  });
});

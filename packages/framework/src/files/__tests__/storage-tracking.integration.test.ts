// tenant_storage_usage MSP — aggregates upload sizes per tenant.
//
// Proves:
//   1. Two uploads from the same tenant end up on a single row with the
//      sums and counts incremented atomically.
//   2. Uploads from different tenants land on separate rows — no cross-
//      tenant leakage through the UPSERT.
//   3. The table column types survive round-trip (bigint → number via
//      Drizzle's mode:"number", so arithmetic in assertions Just Works).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { asRawClient, selectMany } from "../../db/query";
import { createTenantDb } from "../../db/tenant-db";
import type { SessionUser } from "../../engine";
import { createTestUser, setupTestStack, type TestStack, TestUsers } from "../../stack";
import { buildMultipartBody, patchFileInstanceofForBunTest } from "../../testing";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  fileRefEntity,
  fileRefsTable,
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
  patchFileInstanceofForBunTest();
  provider = createInMemoryFileProvider();
  stack = await setupTestStack({
    features: [createFilesFeature(), filesStorageTrackingFeature],
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
  await asRawClient(stack.db).unsafe(
    `TRUNCATE kumiko_events, kumiko_event_consumers, file_refs, read_tenant_storage_usage RESTART IDENTITY CASCADE`,
  );
  await stack.eventDispatcher?.ensureRegistered();
});

async function upload(user: SessionUser, name: string, content: Uint8Array): Promise<string> {
  const token = await stack.jwt.sign(user);
  const formData = new FormData();
  formData.append("file", new File([Buffer.from(content)], name, { type: "image/png" }));
  const { body: multipartBody, contentType } = await buildMultipartBody(formData);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body: multipartBody,
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

async function deleteFile(user: SessionUser, id: string): Promise<void> {
  const token = await stack.jwt.sign(user);
  const res = await stack.app.request(`/api/files/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
}

async function restoreFile(user: SessionUser, id: string): Promise<void> {
  // No HTTP route for restore — drive the entity executor directly, which is
  // the same path file-routes uses for create/delete. Emits fileRef.restored
  // with { previous } that the MSP re-increments on.
  const executor = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
    entityName: "fileRef",
  });
  const result = await executor.restore({ id }, user, createTenantDb(stack.db, user.tenantId));
  if (!result.isSuccess) throw new Error(`restore failed: ${JSON.stringify(result)}`);
}

async function usageFor(tenantId: string): Promise<{ totalBytes: number; fileCount: number }> {
  const [row] = await selectMany(stack.db, tenantStorageUsageTable, { tenantId });
  return row
    ? { totalBytes: Number(row["totalBytes"]) ?? 0, fileCount: Number(row["fileCount"]) ?? 0 }
    : { totalBytes: 0, fileCount: 0 };
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
    const rows = await selectMany(stack.db, tenantStorageUsageTable, { tenantId: admin.tenantId });
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

  test("delete decrements totalBytes and fileCount by the deleted file's size", async () => {
    const idSmall = await upload(admin, "a.png", SMALL);
    await upload(admin, "b.png", LARGE);
    await stack.eventDispatcher?.runOnce();

    await deleteFile(admin, idSmall);
    await stack.eventDispatcher?.runOnce();

    const usage = await usageFor(admin.tenantId);
    expect(usage).toEqual({ totalBytes: LARGE.length, fileCount: 1 });
  });

  test("restore re-increments after delete — round-trip leaves usage unchanged", async () => {
    const id = await upload(admin, "a.png", SMALL);
    await stack.eventDispatcher?.runOnce();
    expect(await usageFor(admin.tenantId)).toEqual({ totalBytes: SMALL.length, fileCount: 1 });

    await deleteFile(admin, id);
    await stack.eventDispatcher?.runOnce();
    expect(await usageFor(admin.tenantId)).toEqual({ totalBytes: 0, fileCount: 0 });

    await restoreFile(admin, id);
    await stack.eventDispatcher?.runOnce();
    expect(await usageFor(admin.tenantId)).toEqual({ totalBytes: SMALL.length, fileCount: 1 });
  });

  test("lastUpdatedAt is set and advances on subsequent uploads", async () => {
    await upload(admin, "a.png", SMALL);
    await stack.eventDispatcher?.runOnce();

    const [first] = await selectMany(stack.db, tenantStorageUsageTable, {
      tenantId: admin.tenantId,
    });
    expect(first?.["lastUpdatedAt"]).toBeInstanceOf(Temporal.Instant);

    // Postgres NOW() resolution is microseconds; a second upload a beat
    // later must produce a strictly later timestamp (or at least not an
    // older one). We assert >= rather than > to keep the test tolerant
    // of same-clock-tick runs.
    await new Promise((r) => setTimeout(r, 10));
    await upload(admin, "b.png", LARGE);
    await stack.eventDispatcher?.runOnce();

    const [second] = await selectMany(stack.db, tenantStorageUsageTable, {
      tenantId: admin.tenantId,
    });
    expect(second?.["lastUpdatedAt"]).toBeInstanceOf(Temporal.Instant);
    if (!first?.["lastUpdatedAt"] || !second?.["lastUpdatedAt"]) throw new Error("missing rows");
    expect(
      Temporal.Instant.compare(second["lastUpdatedAt"], first["lastUpdatedAt"]),
    ).toBeGreaterThanOrEqual(0);
  });
});

// The MSP tests above prove upload *accounting*; nothing asserts the file
// actually comes back. This pins the full HTTP read path (GET /files/:id →
// provider readStream → response body) — the user-facing roundtrip.
describe("file download roundtrip (GET /files/:id)", () => {
  async function download(user: SessionUser, id: string): Promise<Response> {
    const token = await stack.jwt.sign(user);
    return stack.app.request(`/api/files/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  test("returns the exact bytes that were uploaded", async () => {
    const id = await upload(admin, "roundtrip.png", LARGE);
    const res = await download(admin, id);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(LARGE);
  });

  test("a deleted file is no longer downloadable", async () => {
    const id = await upload(admin, "gone.png", SMALL);
    await deleteFile(admin, id);
    expect((await download(admin, id)).status).toBe(404);
  });

  test("a cross-tenant download is rejected (404, no existence oracle)", async () => {
    const id = await upload(admin, "tenant-a-only.png", SMALL);
    const res = await download(otherAdmin, id);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("not_found");
  });
});

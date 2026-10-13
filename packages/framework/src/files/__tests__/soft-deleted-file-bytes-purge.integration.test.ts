// The per-tenant soft-delete cleanup removes the bytes of expired soft-deleted fileRefs
// (original and derivatives) before it removes their rows; a row whose bytes could not be
// deleted stays for the next run.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "../../bun-db/query.js";
import { selectMany } from "../../db/query.js";
import { SOFT_DELETE_CLEANUP_JOB } from "../../engine/soft-delete-cleanup.js";
import { setupTestStack, type TestStack, TestUsers } from "../../stack/index.js";
import { buildMultipartBody, patchFileInstanceofForBunTest } from "../../testing/index.js";
import { createInMemoryFileProvider, type InMemoryFileProvider } from "../in-memory-provider.js";
import { createFilesFeature, deriveKey, fileRefsTable } from "../index.js";

const DERIVATIVE_SUFFIX = "thumb-0123456789abcdef";
const PNG_BYTES = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...Array(12).fill(0),
]);

const memory: InMemoryFileProvider = createInMemoryFileProvider();
let failDeleteForKey: string | undefined;
// Same storage, but delete() can be told to fail for one key.
const provider: InMemoryFileProvider = {
  ...memory,
  async delete(key) {
    if (key === failDeleteForKey) throw new Error("simulated storage outage");
    await memory.delete(key);
  },
};

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature()],
    files: { storageProvider: provider },
    jobs: {
      consumerLane: "worker",
      getActiveTenantIds: async () => [admin.tenantId],
    },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  failDeleteForKey = undefined;
});

async function uploadAndSoftDelete(
  name: string,
  ageDays: number,
): Promise<{
  id: string;
  storageKey: string;
  derivativeKey: string;
}> {
  const token = await stack.jwt.sign(admin);
  const formData = new FormData();
  formData.append("file", new File([Buffer.from(PNG_BYTES)], name, { type: "image/png" }));
  const { body, contentType } = await buildMultipartBody(formData);
  const upload = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(upload.status).toBe(201);
  const { id } = (await upload.json()) as { id: string };

  const [row] = await selectMany<{ storageKey: string }>(stack.db, fileRefsTable, { id });
  const storageKey = row?.storageKey;
  if (storageKey === undefined) throw new Error("uploaded fileRef row missing");
  const derivativeKey = deriveKey(storageKey, DERIVATIVE_SUFFIX);
  await provider.write(derivativeKey, PNG_BYTES, "image/png");

  const deleted = await stack.app.request(`/api/files/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(deleted.status).toBe(200);

  // kumiko-lint-ignore raw-sql test fixture ages deletedAt past the default grace period
  await asRawClient(stack.db).unsafe(
    `UPDATE file_refs SET deleted_at = now() - make_interval(days => $2) WHERE id = $1`,
    [id, ageDays],
  );
  return { id, storageKey, derivativeKey };
}

async function rowExists(id: string): Promise<boolean> {
  return (await selectMany(stack.db, fileRefsTable, { id })).length > 0;
}

async function runCleanup(): Promise<void> {
  const jobRunner = stack.jobRunner;
  if (!jobRunner) throw new Error("setupTestStack({ jobs }) did not wire a jobRunner");
  await jobRunner.dispatch(SOFT_DELETE_CLEANUP_JOB, {});
  await stack.drainJobs();
}

describe("soft-delete cleanup of fileRef bytes", () => {
  test("an expired soft-deleted fileRef loses original, derivative and row", async () => {
    const file = await uploadAndSoftDelete("expired.png", 400);
    expect(provider.keys()).toContain(file.storageKey);
    expect(provider.keys()).toContain(file.derivativeKey);

    await runCleanup();

    expect(await rowExists(file.id)).toBe(false);
    expect(provider.keys()).not.toContain(file.storageKey);
    expect(provider.keys()).not.toContain(file.derivativeKey);
  });

  test("a soft-deleted fileRef inside the grace period keeps bytes and row", async () => {
    const file = await uploadAndSoftDelete("fresh.png", 1);

    await runCleanup();

    expect(await rowExists(file.id)).toBe(true);
    expect(provider.keys()).toContain(file.storageKey);
    expect(provider.keys()).toContain(file.derivativeKey);
  });

  test("a failed byte delete keeps that row and bytes, other due rows are still purged", async () => {
    const broken = await uploadAndSoftDelete("broken.png", 400);
    const healthy = await uploadAndSoftDelete("healthy.png", 400);
    failDeleteForKey = broken.storageKey;

    await runCleanup();

    expect(await rowExists(broken.id)).toBe(true);
    expect(provider.keys()).toContain(broken.storageKey);
    expect(await rowExists(healthy.id)).toBe(false);
    expect(provider.keys()).not.toContain(healthy.storageKey);
    expect(provider.keys()).not.toContain(healthy.derivativeKey);

    // The next run retries the kept row once storage works again.
    failDeleteForKey = undefined;
    await runCleanup();
    expect(await rowExists(broken.id)).toBe(false);
    expect(provider.keys()).not.toContain(broken.storageKey);
    expect(provider.keys()).not.toContain(broken.derivativeKey);
  });
});

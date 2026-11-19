// purgeFileRef removes original, derivatives and row in one call, and degrades to a soft delete
// that the soft-delete cleanup finishes when the bytes cannot be removed.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { selectMany } from "../../db/query.ts";
import { createTenantDb } from "../../db/tenant-db.ts";
import { createSystemUser } from "../../engine/index.ts";
import { TestUsers, testTenantId } from "../../seeding/index.ts";
import { createInMemoryFileProvider, type InMemoryFileProvider } from "../in-memory-provider.ts";
import { createFileContext, createFilesFeature, deriveKey, fileRefsTable } from "../index.ts";
import { purgeFileRef } from "../purge-file-ref.ts";

const DERIVATIVE_SUFFIX = "thumb-0123456789abcdef";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000999";
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
let failDeleteForKeys: ReadonlySet<string> = new Set();
// Same storage, but delete() can be told to fail for one key.
const provider: InMemoryFileProvider = {
  ...memory,
  async delete(key) {
    if (failDeleteForKeys.has(key)) throw new Error("simulated storage outage");
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
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  failDeleteForKeys = new Set();
});

const ctx = (tenantId = admin.tenantId) => ({
  db: createTenantDb({ db: stack.db, tenantId }),
  user: createSystemUser(tenantId),
  files: createFileContext(() => Promise.resolve(provider), tenantId),
});

async function upload(): Promise<{ id: string; storageKey: string; derivativeKey: string }> {
  const token = await stack.jwt.sign(admin);
  const formData = new FormData();
  formData.append("file", new File([Buffer.from(PNG_BYTES)], "pic.png", { type: "image/png" }));
  const { body, contentType } = await buildMultipartBody(formData);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  const row = await rowOf(id);
  const storageKey = row?.storageKey;
  if (storageKey === undefined) throw new Error("uploaded fileRef row missing");
  const derivativeKey = deriveKey(storageKey, DERIVATIVE_SUFFIX);
  await provider.write(derivativeKey, PNG_BYTES, "image/png");
  return { id, storageKey, derivativeKey };
}

async function rowOf(id: string) {
  const [row] = await selectMany<{ storageKey: string; isDeleted: boolean }>(
    stack.db,
    fileRefsTable,
    { id },
  );
  return row;
}

describe("purgeFileRef", () => {
  test("removes row, original and derivative", async () => {
    const file = await upload();

    expect(await purgeFileRef(ctx(), file.id)).toEqual({ kind: "purged" });

    expect(await rowOf(file.id)).toBeUndefined();
    expect(provider.keys()).not.toContain(file.storageKey);
    expect(provider.keys()).not.toContain(file.derivativeKey);
  });

  test("leaves a file bound to another entity type untouched", async () => {
    const file = await upload();

    const outcome = await purgeFileRef(ctx(), file.id, { entityType: "some-other-entity" });

    expect(outcome).toEqual({ kind: "bound-elsewhere" });
    expect((await rowOf(file.id))?.isDeleted).toBe(false);
    expect(provider.keys()).toContain(file.storageKey);
    expect(provider.keys()).toContain(file.derivativeKey);
  });

  test("without a file context it soft-deletes the row and keeps the bytes", async () => {
    const file = await upload();

    const outcome = await purgeFileRef({ ...ctx(), files: undefined }, file.id);

    expect(outcome).toEqual({ kind: "left-to-cleanup", bytesDeleted: false, rowSoftDeleted: true });
    expect((await rowOf(file.id))?.isDeleted).toBe(true);
    expect(provider.keys()).toContain(file.storageKey);
  });

  test("a failing storage delete leaves the original and soft-deletes the row", async () => {
    const file = await upload();
    failDeleteForKeys = new Set([file.storageKey]);

    const outcome = await purgeFileRef(ctx(), file.id);

    expect(outcome).toEqual({ kind: "left-to-cleanup", bytesDeleted: false, rowSoftDeleted: true });
    expect((await rowOf(file.id))?.isDeleted).toBe(true);
    expect(provider.keys()).toContain(file.storageKey);
  });

  test("an unknown id is not-found", async () => {
    expect(await purgeFileRef(ctx(), UNKNOWN_ID)).toEqual({ kind: "not-found" });
  });

  test("a foreign tenant gets not-found and nothing is touched", async () => {
    const file = await upload();

    const outcome = await purgeFileRef(ctx(testTenantId(7701)), file.id);

    expect(outcome).toEqual({ kind: "not-found" });
    expect(await rowOf(file.id)).toBeDefined();
    expect(provider.keys()).toContain(file.storageKey);
  });

  test("an already soft-deleted file is purged", async () => {
    const file = await upload();
    const token = await stack.jwt.sign(admin);
    const deleted = await stack.app.request(`/api/files/${file.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(deleted.status).toBe(200);

    expect(await purgeFileRef(ctx(), file.id)).toEqual({ kind: "purged" });

    expect(await rowOf(file.id)).toBeUndefined();
    expect(provider.keys()).not.toContain(file.storageKey);
  });
});

// unclaimedUploadReaders: declarative read access to uploads without a target field. Real
// stack, real HTTP calls.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEntity,
  createFileField,
  createTextField,
  defineFeature,
} from "../../engine/index.js";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "../../stack/index.js";
import { buildMultipartBody, patchFileInstanceofForBunTest } from "../../testing/index.js";
import { createFilesFeature, type FilesFeatureOptions } from "../feature.js";
import { createLocalProvider } from "../local-provider.js";

const noteEntity = createEntity({
  table: "unclaimed_notes",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    attachment: createFileField(),
  },
});

const noteFeature = defineFeature("unclaimed-notes", (r) => {
  r.entity("note", noteEntity);
});

const tenant = testTenantId(1);
const uploader = createTestUser({ id: 1, tenantId: tenant, roles: ["User"] });
const clerk = createTestUser({ id: 2, tenantId: tenant, roles: ["Clerk"] });
const outsider = createTestUser({ id: 3, tenantId: tenant, roles: ["User"] });
const otherTenantClerk = createTestUser({ id: 4, tenantId: testTenantId(2), roles: ["Clerk"] });

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 minimal");

let storagePath: string;
const stacks: TestStack[] = [];

async function startStack(options: FilesFeatureOptions): Promise<TestStack> {
  const stack = await setupTestStack({
    features: [createFilesFeature(options), noteFeature],
    files: { storageProvider: createLocalProvider(storagePath) },
  });
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
  stacks.push(stack);
  return stack;
}

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  storagePath = await mkdtemp(join(tmpdir(), "kumiko-unclaimed-readers-"));
});

afterAll(async () => {
  for (const stack of stacks) await stack.cleanup();
  await rm(storagePath, { recursive: true, force: true });
});

async function upload(
  stack: TestStack,
  as: typeof uploader,
  fields: { entityType?: string; fieldName?: string } = {},
): Promise<string> {
  const token = await stack.jwt.sign(as);
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
  fd.append("file", new File([Buffer.from(PDF_BYTES)], "doc.pdf", { type: "application/pdf" }));
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function request(
  stack: TestStack,
  as: typeof uploader,
  fileRefId: string,
  suffix = "",
  method = "GET",
): Promise<number> {
  const token = await stack.jwt.sign(as);
  const res = await stack.app.request(`/api/files/${fileRefId}${suffix}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.status;
}

describe("unclaimedUploadReaders", () => {
  let stack: TestStack;
  beforeAll(async () => {
    stack = await startStack({ unclaimedUploadReaders: ["Clerk"] });
  });

  test("a reader role reads an unclaimed upload and its meta, but cannot delete it", async () => {
    const fileRefId = await upload(stack, uploader);

    expect(await request(stack, clerk, fileRefId)).toBe(200);
    expect(await request(stack, clerk, fileRefId, "/meta")).toBe(200);
    expect(await request(stack, clerk, fileRefId, "", "DELETE")).toBe(404);
    expect(await request(stack, uploader, fileRefId)).toBe(200);
  });

  test("users without the role and other tenants get 404", async () => {
    const fileRefId = await upload(stack, uploader);

    expect(await request(stack, outsider, fileRefId)).toBe(404);
    expect(await request(stack, otherTenantClerk, fileRefId)).toBe(404);
  });

  test("a pending upload for a target field stays private to its uploader", async () => {
    const fileRefId = await upload(stack, uploader, {
      entityType: "note",
      fieldName: "attachment",
    });

    expect(await request(stack, clerk, fileRefId)).toBe(404);
    expect(await request(stack, uploader, fileRefId)).toBe(200);
  });
});

describe("without unclaimedUploadReaders", () => {
  test("a clerk cannot read someone else's unclaimed upload", async () => {
    const stack = await startStack({});
    const fileRefId = await upload(stack, uploader);

    expect(await request(stack, clerk, fileRefId)).toBe(404);
  });
});

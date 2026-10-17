// A fileRef moved to another tenant (handover) or owned by the system tenant (system template logo)
// is read from the file store of its own key space. Without a provider resolver the context's
// `files` only reaches the job tenant, so the system tenant's file is unreachable: an inline image
// is then skipped with a warning instead of failing the whole mail.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  createFileContext,
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-framework/testing";
import { fileContextForTenant } from "../../file-foundation/index.js";
import { createEmailAttachmentReader } from "../channel-context.js";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const provider = createInMemoryFileProvider();
const jobTenantId = testTenantId(1);
const uploader = createTestUser({ id: 1, tenantId: jobTenantId, roles: ["Admin"] });

let stack: TestStack;

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

async function uploadLogo(): Promise<string> {
  const token = await stack.jwt.sign(uploader);
  const formData = new FormData();
  formData.append("file", new File([Buffer.from(PNG_BYTES)], "logo.png", { type: "image/png" }));
  const { body, contentType } = await buildMultipartBody(formData);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function moveFileRowTo(fileRefId: string, tenantId: string): Promise<void> {
  await asRawClient(stack.db).unsafe(`UPDATE file_refs SET tenant_id = $2 WHERE id = $1`, [
    fileRefId,
    tenantId,
  ]);
}

// Job context without a provider resolver: ctx.files is bound to the job's tenant.
function readerWithoutResolver() {
  const jobContext = {
    files: createFileContext(() => Promise.resolve(provider), jobTenantId),
  };
  return createEmailAttachmentReader(stack.db, stack.registry, jobTenantId, undefined, (tenantId) =>
    fileContextForTenant(jobContext, jobTenantId, tenantId),
  );
}

describe("inline attachments without a provider resolver", () => {
  test("a system tenant logo is skipped instead of failing the mail", async () => {
    const fileRefId = await uploadLogo();
    await moveFileRowTo(fileRefId, SYSTEM_TENANT_ID);

    const read = await readerWithoutResolver()(
      { kind: "inline", cid: "logo", fileRefId },
      "template",
    );

    expect(read).toBeNull();
  });

  test("a file ref the job tenant owns after a handover is read although its key carries the old prefix", async () => {
    const fileRefId = await uploadLogo();
    const previousOwnerPrefix = `${testTenantId(9)}/handed-over/logo.png`;
    await provider.write(previousOwnerPrefix, PNG_BYTES, "image/png");
    await asRawClient(stack.db).unsafe(`UPDATE file_refs SET storage_key = $2 WHERE id = $1`, [
      fileRefId,
      previousOwnerPrefix,
    ]);

    const read = await readerWithoutResolver()(
      { kind: "inline", cid: "logo", fileRefId },
      "template",
    );

    expect(read?.content).toEqual(PNG_BYTES);
  });
});

// A system tenant mail sent outside a handler (wire hook, worker component) reads its attachments
// through the file context the wire deps carry, built from the post-buildServer AppContext.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildSystemChannelContext } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createFileRefFromBytes,
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { makeFilesForTenant } from "../files-for-tenant.ts";

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
const otherTenantId = testTenantId(1);

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createFilesFeature()],
    files: { storageProvider: createInMemoryFileProvider() },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

const filesForTenant = () => makeFilesForTenant(stack.context);

async function createPdfFileRef(tenantId: TenantId): Promise<string> {
  const created = await createFileRefFromBytes(
    {
      db: createTenantDb({ db: stack.db, tenantId }),
      files: filesForTenant()(tenantId),
      registry: stack.registry,
      user: createSystemUser(tenantId),
    },
    { fileName: "doc.pdf", mimeType: "application/pdf", data: PDF_BYTES },
  );
  if (!created.isSuccess) throw new Error(`file ref setup failed: ${created.error.message}`);
  return created.data.id;
}

function systemContext() {
  return buildSystemChannelContext({
    db: stack.db,
    registry: stack.registry,
    filesForTenant: filesForTenant(),
  });
}

describe("buildSystemChannelContext with wire-hook file access", () => {
  test("reads a system tenant file attachment with its bytes and content type", async () => {
    const fileRefId = await createPdfFileRef(SYSTEM_TENANT_ID);

    const read = await systemContext().readAttachment?.(
      { kind: "file", fileRefId, fileName: "doc.pdf" },
      "template",
    );

    expect(read?.content).toEqual(PDF_BYTES);
    expect(read?.contentType).toBe("application/pdf");
  });

  test("refuses another tenant's file for a message-origin ref", async () => {
    const fileRefId = await createPdfFileRef(otherTenantId);

    const read = await systemContext().readAttachment?.(
      { kind: "file", fileRefId, fileName: "doc.pdf" },
      "message",
    );

    expect(read).toBeNull();
  });
});

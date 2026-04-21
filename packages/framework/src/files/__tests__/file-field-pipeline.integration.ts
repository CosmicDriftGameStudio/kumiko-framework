// End-to-end regression for file/image-field wiring through the CRUD
// pipeline. The column-level fix in table-builder.ts is necessary but not
// sufficient: the Zod validation layer in schema-builder.ts also had a
// residual `z.number()` for file/image fields from an earlier era. Without
// that fix the pipeline would reject every valid UUID at the validation
// gate, before the column type ever mattered.
//
// This suite proves the whole path works end-to-end:
//   POST /api/files → upload → receive file UUID
//   POST /api/write → entity:create with file-field: <uuid>
//   POST /api/query → entity:detail → UUID round-trips
//   POST /api/write → entity:update with new file-UUID
//   POST /api/query → entity:detail → new UUID persisted

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  createEntity,
  createFileField,
  createImageField,
  createTextField,
  defineEntityQueryHandler,
  defineEntityWriteHandler,
  defineFeature,
} from "../../engine";
import {
  createEntityTable,
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
} from "../../testing";
import { createLocalProvider } from "../local-provider";

const documentEntity = createEntity({
  table: "pipeline_documents",
  idType: "uuid",
  fields: {
    title: createTextField({ required: true }),
    attachment: createFileField(),
    cover: createImageField(),
  },
});

const documentFeature = defineFeature("pipeline-documents", (r) => {
  r.entity("document", documentEntity);
  for (const verb of ["create", "update", "detail"] as const) {
    if (verb === "detail") {
      r.queryHandler(
        defineEntityQueryHandler(`document:${verb}`, documentEntity, {
          access: { roles: ["Admin", "User"] },
        }),
      );
    } else {
      r.writeHandler(
        defineEntityWriteHandler(`document:${verb}`, documentEntity, {
          access: { roles: ["Admin", "User"] },
        }),
      );
    }
  }
});

let stack: TestStack;
let storagePath: string;

const tenantId = testTenantId(1);
const user = createTestUser({ id: 1, tenantId, roles: ["Admin"] });

beforeAll(async () => {
  storagePath = await mkdtemp(join(tmpdir(), "kumiko-file-field-pipeline-"));
  stack = await setupTestStack({
    features: [documentFeature],
    files: { storageProvider: createLocalProvider(storagePath) },
  });
  await createEntityTable(stack.db.db, documentEntity);
});

afterAll(async () => {
  await stack.cleanup();
  await rm(storagePath, { recursive: true, force: true });
});

beforeEach(async () => {
  await stack.db.db.execute(sql`TRUNCATE pipeline_documents`);
});

async function uploadFile(fileName: string, body: Uint8Array, mimeType: string): Promise<string> {
  const token = await stack.jwt.sign(user);
  const fd = new FormData();
  fd.append("file", new File([Buffer.from(body)], fileName, { type: mimeType }));
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  // File-routes return 201 Created on successful upload.
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id: string };
  return json.id;
}

describe("file/image field through the CRUD pipeline", () => {
  test("create entity with file-field UUID → detail round-trips the UUID", async () => {
    const fileId = await uploadFile("doc.pdf", new Uint8Array([1, 2, 3]), "application/pdf");
    const imageId = await uploadFile("cover.png", new Uint8Array([4, 5, 6]), "image/png");

    // Create through the standard write pipeline — this is the path where the
    // pre-fix validation (z.number() for file/image) would have rejected the
    // UUID with a zod error. If we get past this, both schema + column agree.
    const created = await stack.http.writeOk<{ id: string }>(
      "pipeline-documents:write:document:create",
      { title: "Annual report", attachment: fileId, cover: imageId },
      user,
    );

    const detail = await stack.http.queryOk<{
      id: string;
      title: string;
      attachment: string;
      cover: string;
    }>("pipeline-documents:query:document:detail", { id: created.id }, user);

    expect(detail).toMatchObject({
      id: created.id,
      title: "Annual report",
      attachment: fileId,
      cover: imageId,
    });
  });

  test("update entity swaps file-field UUIDs cleanly", async () => {
    const oldFile = await uploadFile("v1.pdf", new Uint8Array([1]), "application/pdf");
    const newFile = await uploadFile("v2.pdf", new Uint8Array([2]), "application/pdf");

    const created = await stack.http.writeOk<{ id: string }>(
      "pipeline-documents:write:document:create",
      { title: "Swap target", attachment: oldFile },
      user,
    );

    await stack.http.writeOk(
      "pipeline-documents:write:document:update",
      { id: created.id, version: 1, changes: { attachment: newFile } },
      user,
    );

    const detail = await stack.http.queryOk<{ attachment: string }>(
      "pipeline-documents:query:document:detail",
      { id: created.id },
      user,
    );
    expect(detail.attachment).toBe(newFile);
  });

  test("invalid UUID rejected by validation — proves the schema gate actually checks", async () => {
    // With the pre-fix z.number() this would have returned "expected number".
    // With z.uuid() we get a proper uuid-format error. Either way the point
    // is: the validation layer is actually exercising the file-field rule,
    // not silently stripping it.
    const err = await stack.http.writeErr(
      "pipeline-documents:write:document:create",
      { title: "Invalid", attachment: "not-a-uuid" },
      user,
    );
    // Validation errors bubble as 400 from the framework with a zod issues
    // payload. We don't pin the exact shape here — just that it rejected.
    expect(err).toBeDefined();
  });
});

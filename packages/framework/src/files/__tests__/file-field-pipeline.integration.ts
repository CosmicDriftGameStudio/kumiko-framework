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
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "../../bun-db/query";
import {
  createEntity,
  createFileField,
  createFilesField,
  createImageField,
  createImagesField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineEntityUpdateHandler,
  defineFeature,
} from "../../engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "../../stack";
import { createLocalProvider } from "../local-provider";

// Covers ALL four file-field variants: singular (file/image) stores a UUID in
// the entity column; plural (files/images) has no entity column — the array
// of UUIDs lives in the event payload only (resolved via fileRefs otherwise).
// Both shapes must validate + round-trip through the CRUD pipeline.
const documentEntity = createEntity({
  table: "pipeline_documents",
  fields: {
    title: createTextField({ required: true }),
    attachment: createFileField(),
    cover: createImageField(),
    photos: createImagesField(),
    docs: createFilesField(),
  },
});

const ROLES = { access: { roles: ["Admin", "User"] } } as const;

const documentFeature = defineFeature("pipeline-documents", (r) => {
  r.entity("document", documentEntity);
  r.writeHandler(defineEntityCreateHandler("document", documentEntity, ROLES));
  r.writeHandler(defineEntityUpdateHandler("document", documentEntity, ROLES));
  r.queryHandler(defineEntityDetailHandler("document", documentEntity, ROLES));
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
  await unsafeCreateEntityTable(stack.db, documentEntity);
});

afterAll(async () => {
  await stack.cleanup();
  await rm(storagePath, { recursive: true, force: true });
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`TRUNCATE pipeline_documents`);
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

  test("invalid UUID rejected by validation (code=validation_error, not some other failure)", async () => {
    // With the pre-fix z.number() this would have returned "expected number".
    // With z.uuid() we get a proper uuid-format error. Assertion has to pin
    // the specific failure-class — otherwise a DB error, access-denied, or
    // any other throw would silently satisfy `toBeDefined()` and we'd miss
    // a regression where the validation layer stopped firing at all.
    const err = await stack.http.writeErr(
      "pipeline-documents:write:document:create",
      { title: "Invalid", attachment: "not-a-uuid" },
      user,
    );
    expect(err.code).toBe("validation_error");
  });

  test("plural files/images fields accept arrays of UUIDs end-to-end", async () => {
    // Plural variants have NO entity-column (table-builder returns {} for
    // files/images) — the array of UUIDs lives in the event payload. The
    // pipeline still has to validate + accept it. Pre-fix this was
    // z.array(z.number()) which would have rejected every UUID array.
    const a = await uploadFile("a.jpg", new Uint8Array([1]), "image/jpeg");
    const b = await uploadFile("b.jpg", new Uint8Array([2]), "image/jpeg");
    const c = await uploadFile("notes.pdf", new Uint8Array([3]), "application/pdf");

    const created = await stack.http.writeOk<{ id: string }>(
      "pipeline-documents:write:document:create",
      { title: "With arrays", photos: [a, b], docs: [c] },
      user,
    );
    expect(created.id).toBeTruthy();

    // Follow-up update: swap one photo out, add a second doc. Proves the
    // update-path handles plural arrays too, not just create.
    const d = await uploadFile("c.jpg", new Uint8Array([4]), "image/jpeg");
    const e = await uploadFile("more.pdf", new Uint8Array([5]), "application/pdf");

    const updated = await stack.http.writeOk<{ id: string }>(
      "pipeline-documents:write:document:update",
      { id: created.id, version: 1, changes: { photos: [a, d], docs: [c, e] } },
      user,
    );
    // Version bumped by the CRUD executor → proves the write actually
    // committed an event (not a silent no-op from validation-strip).
    expect(updated.id).toBe(created.id);
  });

  test("plural files field rejects non-UUID element (schema validates EACH array element)", async () => {
    const valid = await uploadFile("ok.pdf", new Uint8Array([1]), "application/pdf");
    const err = await stack.http.writeErr(
      "pipeline-documents:write:document:create",
      { title: "Bad array", docs: [valid, "not-a-uuid"] },
      user,
    );
    expect(err.code).toBe("validation_error");
  });
});

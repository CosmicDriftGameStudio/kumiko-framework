// File/image fields carrying a personal annotation stay plaintext uuid columns
// under an active subject KMS (the column holds only the fileRef id), while the
// annotation still drives the Art.-17 hard delete of the binary. Uploads and
// writes go through real HTTP; the DB is only read for the raw-storage asserts.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
} from "@cosmicdrift/kumiko-framework/crypto";
import { asRawClient, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createFileField,
  createImageField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { createInMemoryFileProvider } from "@cosmicdrift/kumiko-framework/files";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createFilesFeature } from "../../files/index.ts";
import { fileRefDeleteHook } from "../index.ts";

const admin = TestUsers.admin;

const documentEntity = createEntity({
  table: "file_field_kms_documents",
  fields: {
    authorId: createTextField({ personal: false, reason: "author_id_test_fixture" }),
    notes: createTextField({ personal: { of: "authorId" }, find: "none" }),
    attachment: createFileField({ personal: { of: "authorId" } }),
    selfie: createImageField({ personal: "self" }),
  },
});

const documentFeature = defineFeature("filepii", (r) => {
  r.entity({ name: "document", ...documentEntity });
  r.crud("document", documentEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin"] } },
  });
});

const CREATE = "filepii:write:document:create";
const DETAIL = "filepii:query:document:detail";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 minimal");
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array(10).fill(0)]);

const provider = createInMemoryFileProvider();
let stack: TestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), documentFeature],
    files: { storageProvider: provider },
  });
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  resetPiiSubjectKmsForTests();
  await stack.cleanup();
});

async function upload(
  fileName: string,
  body: Uint8Array,
  mimeType: string,
  fieldName: string,
): Promise<string> {
  const token = await stack.jwt.sign(admin);
  const fd = new FormData();
  fd.append("entityType", "document");
  fd.append("fieldName", fieldName);
  fd.append("file", new File([Buffer.from(body)], fileName, { type: mimeType }));
  const { body: multipartBody, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body: multipartBody,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function fileRefRow(id: string): Promise<{ storage_key: string; entity_id: string | null }> {
  const rows = await asRawClient(stack.db).unsafe<{
    storage_key: string;
    entity_id: string | null;
  }>(`SELECT storage_key, entity_id FROM file_refs WHERE id = $1`, [id]);
  const row = rows[0];
  if (!row) throw new Error(`no file_refs row ${id}`);
  return row;
}

describe("personal file/image fields under an active subject KMS", () => {
  test("create succeeds, file columns hold the plain fileRef id, text PII is ciphertext, forget hard-deletes the binary", async () => {
    const attachmentRef = await upload("doc.pdf", PDF_BYTES, "application/pdf", "attachment");
    const selfieRef = await upload("me.jpg", JPEG_BYTES, "image/jpeg", "selfie");
    const attachmentKey = (await fileRefRow(attachmentRef)).storage_key;
    const selfieKey = (await fileRefRow(selfieRef)).storage_key;
    expect(await provider.exists(attachmentKey)).toBe(true);

    const { id } = await stack.http.writeOk<{ id: string }>(
      CREATE,
      {
        authorId: admin.id,
        notes: "secret note",
        attachment: attachmentRef,
        selfie: selfieRef,
      },
      admin,
    );

    const rows = await asRawClient(stack.db).unsafe<Record<string, unknown>>(
      `SELECT notes, attachment, selfie FROM file_field_kms_documents WHERE id = $1`,
      [id],
    );
    const raw = rows[0];
    expect(raw?.["attachment"]).toBe(attachmentRef);
    expect(raw?.["selfie"]).toBe(selfieRef);
    expect(isPiiCiphertext(raw?.["notes"])).toBe(true);

    const detail = await stack.http.queryOk<Record<string, unknown>>(DETAIL, { id }, admin);
    expect(detail["attachment"]).toBe(attachmentRef);
    expect(detail["selfie"]).toBe(selfieRef);
    expect(detail["notes"]).toBe("secret note");

    expect((await fileRefRow(attachmentRef)).entity_id).toBe(id);
    expect((await fileRefRow(selfieRef)).entity_id).toBe(id);

    await fileRefDeleteHook(
      {
        db: createTenantDb({ db: stack.db, tenantId: admin.tenantId, mode: "tenant" }),
        registry: stack.registry,
        tenantId: admin.tenantId,
        userId: admin.id,
        buildStorageProvider: async () => provider,
      },
      "delete",
    );

    expect(await provider.exists(attachmentKey)).toBe(false);
    expect(await provider.exists(selfieKey)).toBe(false);
    const left = await asRawClient(stack.db).unsafe<{ id: string }>(
      `SELECT id FROM file_refs WHERE id IN ($1, $2)`,
      [attachmentRef, selfieRef],
    );
    expect(left).toHaveLength(0);
  });
});

// A personal plural file field keeps its UUID array in plaintext in the
// projection column (file fields are excluded from PII encryption), detail/list/
// rebuild read the array back, and the file routes follow the record.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/testing";
import { selectMany } from "../../bun-db/index.js";
import { buildEntityTable } from "../../db/index.js";
import {
  createEntity,
  createImagesField,
  createTextField,
  defineFeature,
  type SessionUser,
} from "../../engine/index.js";
import { createFilesFeature, createInMemoryFileProvider } from "../../files/index.js";
import { rebuildProjection } from "../../pipeline/index.js";
import {
  createTestUser,
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
} from "../../stack/index.js";
import { InMemoryKmsAdapter } from "../in-memory-kms-adapter.js";
import { configurePiiSubjectKms } from "../pii-field-encryption.js";

const admin = TestUsers.admin;
const secondReader = createTestUser({ id: 77, tenantId: admin.tenantId, roles: ["Reader"] });
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array(10).fill(0)]);

const albumEntity = createEntity({
  table: "pii_plural_file_albums",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    photos: createImagesField({ personal: "tenant" }),
  },
});
const albumTable = buildEntityTable("album", albumEntity);

const feature = defineFeature("pluralfilepii", (r) => {
  r.entity("album", albumEntity);
  r.crud("album", albumEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin", "Reader"] } },
  });
});

const CREATE = "pluralfilepii:write:album:create";
const UPDATE = "pluralfilepii:write:album:update";
const DETAIL = "pluralfilepii:query:album:detail";
const LIST = "pluralfilepii:query:album:list";
const PROJECTION = "pluralfilepii:projection:album-entity";

const FIRST = "5d0c6b7e-3a4f-4c1d-8e2a-000000000001";
const SECOND = "5d0c6b7e-3a4f-4c1d-8e2a-000000000002";
const THIRD = "5d0c6b7e-3a4f-4c1d-8e2a-000000000003";

let stack: TestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), feature],
    files: { storageProvider: createInMemoryFileProvider() },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterEach(async () => {
  resetPiiSubjectKmsForTests();
  await resetEventStore(stack, ["pii_plural_file_albums"]);
});

async function createAlbum(photos: readonly string[]): Promise<string> {
  const { id } = await stack.http.writeOk<{ id: string }>(
    CREATE,
    { title: "Album", photos },
    admin,
  );
  return id;
}

async function detail(id: string): Promise<Record<string, unknown>> {
  return stack.http.queryOk<Record<string, unknown>>(DETAIL, { id }, admin);
}

async function storedPhotos(id: string): Promise<unknown> {
  const [row] = await selectMany(stack.db, albumTable, { id });
  return row?.photos;
}

describe("personal plural file field", () => {
  test("column holds the plain ordered array, detail and list return it", async () => {
    const id = await createAlbum([SECOND, FIRST]);

    expect(await storedPhotos(id)).toEqual([SECOND, FIRST]);

    expect((await detail(id))["photos"]).toEqual([SECOND, FIRST]);
    const list = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      LIST,
      { limit: 10 },
      admin,
    );
    expect(list.rows[0]?.["photos"]).toEqual([SECOND, FIRST]);
  });

  test("update stores the reordered array and a projection rebuild reproduces it", async () => {
    const id = await createAlbum([FIRST, SECOND]);
    const row = await detail(id);
    await stack.http.writeOk(
      UPDATE,
      { id, version: row["version"], changes: { photos: [THIRD, FIRST] } },
      admin,
    );
    expect((await detail(id))["photos"]).toEqual([THIRD, FIRST]);

    await rebuildProjection(PROJECTION, { db: stack.db, registry: stack.registry });

    expect(await storedPhotos(id)).toEqual([THIRD, FIRST]);
    expect((await detail(id))["photos"]).toEqual([THIRD, FIRST]);
  });

  test("a pending upload bound by the create is readable by a second reader until an update removes it", async () => {
    const form = new FormData();
    form.append("file", new File([Buffer.from(JPEG_BYTES)], "photo.jpg", { type: "image/jpeg" }));
    form.append("entityType", "album");
    form.append("fieldName", "photos");
    const { body, contentType } = await buildMultipartBody(form);
    const upload = await stack.app.request("/api/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await stack.jwt.sign(admin)}`,
        "Content-Type": contentType,
      },
      body,
    });
    expect(upload.status).toBe(201);
    const { id: fileRefId } = (await upload.json()) as { id: string };
    const readAs = async (reader: SessionUser): Promise<number> =>
      (
        await stack.app.request(`/api/files/${fileRefId}`, {
          headers: { Authorization: `Bearer ${await stack.jwt.sign(reader)}` },
        })
      ).status;
    expect(await readAs(secondReader)).toBe(404);

    const id = await createAlbum([fileRefId]);
    expect(await readAs(secondReader)).toBe(200);

    const row = await detail(id);
    await stack.http.writeOk(
      UPDATE,
      { id, version: row["version"], changes: { photos: [] } },
      admin,
    );
    expect(await readAs(secondReader)).toBe(404);
  });
});

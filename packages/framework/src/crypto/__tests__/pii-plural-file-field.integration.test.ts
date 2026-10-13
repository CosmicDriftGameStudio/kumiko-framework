// A personal plural file field is stored like a personal jsonb field: the UUID
// array is encrypted into a ciphertext JSON string in the event and the
// projection column, and detail/list/rebuild read the array back.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
import { selectMany } from "../../bun-db/index.js";
import { buildEntityTable } from "../../db/index.js";
import {
  createEntity,
  createImagesField,
  createTextField,
  defineFeature,
} from "../../engine/index.js";
import { createFilesFeature, createInMemoryFileProvider } from "../../files/index.js";
import { rebuildProjection } from "../../pipeline/index.js";
import { resetEventStore, setupTestStack, type TestStack, TestUsers } from "../../stack/index.js";
import { InMemoryKmsAdapter } from "../in-memory-kms-adapter.js";
import { configurePiiSubjectKms, PII_CIPHERTEXT_PREFIX_JSON } from "../pii-field-encryption.js";

const admin = TestUsers.admin;

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
    read: { access: { roles: ["Admin"] } },
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
  test("column holds a ciphertext string, detail and list return the ordered array", async () => {
    const id = await createAlbum([SECOND, FIRST]);

    const stored = await storedPhotos(id);
    expect(typeof stored).toBe("string");
    expect(String(stored)).toStartWith(PII_CIPHERTEXT_PREFIX_JSON);
    expect(String(stored)).not.toContain(FIRST);

    expect((await detail(id))["photos"]).toEqual([SECOND, FIRST]);
    const list = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      LIST,
      { limit: 10 },
      admin,
    );
    expect(list.rows[0]?.["photos"]).toEqual([SECOND, FIRST]);
  });

  test("update re-encrypts the reordered array and a projection rebuild reproduces it", async () => {
    const id = await createAlbum([FIRST, SECOND]);
    const row = await detail(id);
    await stack.http.writeOk(
      UPDATE,
      { id, version: row["version"], changes: { photos: [THIRD, FIRST] } },
      admin,
    );
    expect((await detail(id))["photos"]).toEqual([THIRD, FIRST]);

    await rebuildProjection(PROJECTION, { db: stack.db, registry: stack.registry });

    expect(String(await storedPhotos(id))).toStartWith(PII_CIPHERTEXT_PREFIX_JSON);
    expect((await detail(id))["photos"]).toEqual([THIRD, FIRST]);
  });
});

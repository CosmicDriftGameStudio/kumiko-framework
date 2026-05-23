// Regression test for the file/image entity-column type: must be UUID to
// match fileRefsTable.id (uuid). Pre-fix the column was `integer`, which
// silently blocked any client from storing a fileRef reference on the
// entity — UUID → integer cast raised a PG error or truncated.
//
// Intentionally a minimal dedicated suite rather than a case in
// files.integration.ts because the bug is about *table generation*, not
// runtime behaviour of the upload route.

import { sql } from "@cosmicdrift/kumiko-framework/db";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createEntity, createFileField, createImageField } from "../../engine";
import { createTestDb, type TestDb, unsafeCreateEntityTable, unsafePushTables } from "../../stack";
import { generateId } from "../../utils";
import { fileRefsTable } from "../file-ref-table";
import { asRawClient } from "../../bun-db/query";

// Entity with BOTH singular file-field types exercised — the bug applied
// identically to `file` and `image` (same switch-case in table-builder).
const documentEntity = createEntity({
  table: "regression_documents",
  fields: {
    attachment: createFileField(),
    cover: createImageField(),
  },
});

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafePushTables(testDb.db, { fileRefsTable });
  await unsafeCreateEntityTable(testDb.db, documentEntity);
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("file-field entity-column type", () => {
  test("`file` and `image` fields generate UUID columns (not integer)", async () => {
    // Pull the actual column type from information_schema. This is the
    // load-bearing assertion: the type emitted by drizzle-kit during
    // `unsafeCreateEntityTable` must be `uuid`. A regression to `integer` would
    // fail here even if higher-level code happened to still work through
    // implicit casts.
    const rows = await asRawClient(testDb.db).unsafe(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'regression_documents'
        AND column_name IN ('attachment', 'cover')
      ORDER BY column_name
    `);
    const arr = rows as unknown as Array<{ column_name: string; data_type: string }>;
    expect(arr).toEqual([
      { column_name: "attachment", data_type: "uuid" },
      { column_name: "cover", data_type: "uuid" },
    ]);
  });

  test("storing a fileRef UUID in a file-field column round-trips cleanly", async () => {
    // Seed a fileRef row so we have a real UUID to reference. Full upload
    // flow isn't exercised here — we're verifying the CRUD column contract.
    const fileUuid = generateId();
    const tenantId = generateId();
    await asRawClient(testDb.db).unsafe(`
      INSERT INTO file_refs (id, tenant_id, storage_key, file_name, mime_type, size)
      VALUES (
        $1::uuid, $2::uuid, 'seed-key',
        'seed.pdf', 'application/pdf', 1024
      )
    `, [fileUuid, tenantId]);

    const docId = generateId();
    await asRawClient(testDb.db).unsafe(`
      INSERT INTO regression_documents (id, tenant_id, attachment, cover)
      VALUES (
        $1::uuid, $2::uuid,
        $3::uuid, $4::uuid
      )
    `, [docId, tenantId, fileUuid, fileUuid]);

    const read = await asRawClient(testDb.db).unsafe(`
      SELECT attachment, cover FROM regression_documents WHERE id = $1::uuid
    `, [docId]);
    const docArr = read as unknown as Array<{ attachment: string; cover: string }>;
    expect(docArr[0]?.attachment).toBe(fileUuid);
    expect(docArr[0]?.cover).toBe(fileUuid);
  });

  test("storing a non-UUID value in a file-field column rejects — proves strict typing", async () => {
    // If the column were still `integer`, `'not-a-uuid'` would either
    // truncate or coerce to 0. With uuid the insert raises
    // invalid_text_representation (22P02) — the type is actually enforced.
    const docId = generateId();
    const tenantId = generateId();
    await expect(
      asRawClient(testDb.db).unsafe(`
        INSERT INTO regression_documents (id, tenant_id, attachment)
        VALUES ($1::uuid, $2::uuid, 'not-a-uuid')
      `, [docId, tenantId]),
    ).rejects.toThrow();
  });
});

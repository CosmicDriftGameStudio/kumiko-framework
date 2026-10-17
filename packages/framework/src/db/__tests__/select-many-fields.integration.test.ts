// A projected selectMany must not read an encrypted column at all, so its ciphertext never
// reaches the caller.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  createTestDb,
  type TestDb,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { configurePiiSubjectKms, InMemoryKmsAdapter, isPiiCiphertext } from "../../crypto/index.js";
import { createEntity, createTextField } from "../../engine/factories.js";
import { createProjectionStateTable } from "../../pipeline/projection-state.js";
import { TestUsers } from "../../seeding/seed-users.js";
import { createEventStoreExecutor } from "../event-store-executor.js";
import { asRawClient } from "../query.js";
import { buildEntityTable } from "../table-builder.js";
import { createTenantDb, type TenantDb } from "../tenant-db.js";

const contactEntity = createEntity({
  table: "read_select_fields_contacts",
  fields: {
    email: createTextField({ required: true, personal: "self", find: "none" }),
    label: createTextField({ personal: false, reason: "test_fixture" }),
  },
});
const contactTable = buildEntityTable("contact", contactEntity);

let testDb: TestDb;
let tdb: TenantDb;
const adminUser = TestUsers.admin;

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, contactEntity, "contact");
  await createProjectionStateTable(testDb.db);
  tdb = createTenantDb({ db: testDb.db, tenantId: adminUser.tenantId });
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, read_select_fields_contacts, kumiko_projections RESTART IDENTITY CASCADE`,
  );
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

const crud = createEventStoreExecutor(contactTable, contactEntity, { entityName: "contact" });

describe("TenantDb.selectMany fields", () => {
  test("omits the ciphertext key of an encrypted field", async () => {
    const created = await crud.create({ email: "marc@example.com", label: "boss" }, adminUser, tdb);
    if (!created.isSuccess) throw new Error("create failed");

    const full = await tdb.selectMany<Record<string, unknown>>(contactTable);
    expect(isPiiCiphertext(full[0]?.["email"])).toBe(true);

    const projected = await tdb.selectMany<Record<string, unknown>>(contactTable, undefined, {
      fields: ["id", "label"],
    });
    expect(projected).toEqual([{ id: created.data.id, label: "boss" }]);
  });

  test("rejects an unknown field", async () => {
    await expect(
      tdb.selectMany(contactTable, undefined, { fields: ["id", "nope"] }),
    ).rejects.toThrow(/"nope" is not a column/);
  });
});

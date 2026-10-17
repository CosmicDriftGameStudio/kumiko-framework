// Events written by the old PII backfill can hold kumiko-pii ciphertext in
// file/image uuid fields. The rebuild must restore the plain fileRef id instead
// of failing with invalid uuid input (22P02).

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { unsafeCreateEntityTable } from "@cosmicdrift/kumiko-testing/stack";
import { createTestDb, type TestDb } from "../../bun-db/__tests__/bun-test-db.js";
import {
  configurePiiSubjectKms,
  encryptPiiValueForSubject,
  InMemoryKmsAdapter,
} from "../../crypto/index.js";
import { createEntity, createFileField, defineFeature } from "../../engine/index.js";
import { createRegistry } from "../../engine/registry.js";
import { append } from "../../event-store/index.js";
import { rebuildProjection } from "../../pipeline/index.js";
import { createProjectionStateTable } from "../../pipeline/projection-state.js";
import { TestUsers } from "../../seeding/seed-users.js";
import { ensureTemporalPolyfill } from "../../time/polyfill.js";
import { generateId } from "../../utils/index.js";
import { selectMany } from "../query.js";
import { buildEntityTable } from "../table-builder.js";

const adminUser = TestUsers.admin;
const FIRST_FILE_REF = "11111111-1111-4111-8111-111111111111";
const SECOND_FILE_REF = "22222222-2222-4222-8222-222222222222";

let testDb: TestDb;
let kms: InMemoryKmsAdapter;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await createProjectionStateTable(testDb.db);
});

afterAll(async () => {
  await testDb.cleanup();
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

// One entity per test: a rebuild replays every event of its aggregate type.
async function setupFixture(name: string) {
  const entity = createEntity({
    table: `read_${name}`,
    fields: { attachment: createFileField({ personal: "self" }) },
  });
  const feature = defineFeature(`${name}feature`, (r) => {
    r.entity({ name, ...entity });
  });
  await unsafeCreateEntityTable(testDb.db, entity, name);
  return {
    table: buildEntityTable(name, entity),
    registry: createRegistry([feature]),
    projection: `${name}feature:projection:${name}-entity`,
  };
}

function appendEntityEvent(
  aggregateType: string,
  id: string,
  verb: "created" | "updated",
  expectedVersion: number,
  payload: Record<string, unknown>,
) {
  return append(testDb.db, {
    aggregateId: id,
    aggregateType,
    tenantId: adminUser.tenantId,
    expectedVersion,
    type: `${aggregateType}.${verb}`,
    eventVersion: 1,
    payload,
    metadata: { userId: String(adminUser.id) },
  });
}

async function fileCiphertext(id: string, fileRefId: string): Promise<string> {
  return encryptPiiValueForSubject(
    kms,
    { kind: "user", userId: id },
    fileRefId,
    { requestId: "test" },
    "attachment",
  );
}

describe("applyEntityEvent — legacy PII ciphertext in file fields", () => {
  test("rebuild decrypts ciphertext from created and updated events into the uuid column", async () => {
    kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);
    const { table, registry, projection } = await setupFixture("applyfilepiiplain");
    const id = generateId();
    await appendEntityEvent("applyfilepiiplain", id, "created", 0, {
      attachment: await fileCiphertext(id, FIRST_FILE_REF),
    });
    const second = generateId();
    await appendEntityEvent("applyfilepiiplain", second, "created", 0, {
      attachment: await fileCiphertext(second, FIRST_FILE_REF),
    });
    await appendEntityEvent("applyfilepiiplain", second, "updated", 1, {
      changes: { attachment: await fileCiphertext(second, SECOND_FILE_REF) },
      previous: {},
    });

    await rebuildProjection(projection, { db: testDb.db, registry });

    const rows = await selectMany(testDb.db, table, {});
    const attachmentById = new Map(rows.map((row) => [String(row["id"]), row["attachment"]]));
    expect(attachmentById.get(id)).toBe(FIRST_FILE_REF);
    expect(attachmentById.get(second)).toBe(SECOND_FILE_REF);
  });

  test("rebuild stores null when the subject key was erased", async () => {
    kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);
    const { table, registry, projection } = await setupFixture("applyfilepiierased");
    const id = generateId();
    await appendEntityEvent("applyfilepiierased", id, "created", 0, {
      attachment: await fileCiphertext(id, FIRST_FILE_REF),
    });
    await kms.eraseKey({ kind: "user", userId: id });

    await rebuildProjection(projection, { db: testDb.db, registry });

    const rows = await selectMany(testDb.db, table, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["attachment"]).toBeNull();
  });

  test("rebuild without a subject KMS fails with a clear error instead of invalid uuid input", async () => {
    kms = new InMemoryKmsAdapter();
    const { registry, projection } = await setupFixture("applyfilepiinokms");
    const id = generateId();
    await appendEntityEvent("applyfilepiinokms", id, "created", 0, {
      attachment: await fileCiphertext(id, FIRST_FILE_REF),
    });

    await expect(rebuildProjection(projection, { db: testDb.db, registry })).rejects.toThrow(
      /no subject KMS is configured/,
    );
  });
});

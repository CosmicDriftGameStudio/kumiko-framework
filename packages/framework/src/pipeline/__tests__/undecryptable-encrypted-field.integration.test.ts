// One row whose encrypted field cannot be decrypted (corrupt ciphertext, wrong
// key) must not fail the whole list or its own detail: that field reads null,
// the rest of the row and the other rows are served normally. Real HTTP +
// setupTestStack; the corruption is applied to the read-model table only.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "../../bun-db/index.js";
import { configureEntityFieldEncryption } from "../../db/entity-field-encryption.js";
import { createEntity, createTextField, defineFeature } from "../../engine/index.js";
import { resetEventStore, setupTestStack, type TestStack, TestUsers } from "../../stack/index.js";
import {
  createTestEnvelopeCipher,
  resetEntityFieldEncryptionCacheForTests,
} from "../../testing/index.js";

const admin = TestUsers.admin;

const noteEntity = createEntity({
  table: "uef_notes",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    secret: createTextField({ personal: false, reason: "test_fixture", encrypted: true }),
    requiredSecret: createTextField({
      personal: false,
      reason: "test_fixture",
      encrypted: true,
      required: true,
    }),
  },
});

const feature = defineFeature("uef", (r) => {
  r.entity("note", noteEntity);
  r.crud("note", noteEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin"] } },
  });
});

const CREATE = "uef:write:note:create";
const LIST = "uef:query:note:list";
const DETAIL = "uef:query:note:detail";

let stack: TestStack;

beforeAll(async () => {
  configureEntityFieldEncryption(createTestEnvelopeCipher());
  stack = await setupTestStack({ features: [feature] });
});

afterAll(async () => {
  await stack.cleanup();
  resetEntityFieldEncryptionCacheForTests();
});

afterEach(async () => {
  await resetEventStore(stack, ["uef_notes"]);
});

async function createNote(title: string, secret: string): Promise<string> {
  const { id } = await stack.http.writeOk<{ id: string }>(
    CREATE,
    { title, secret, requiredSecret: `required-${secret}` },
    admin,
  );
  return id;
}

async function corruptStoredSecret(id: string): Promise<void> {
  await asRawClient(stack.db).unsafe(
    `UPDATE uef_notes SET secret = 'not-an-envelope', required_secret = 'not-an-envelope' WHERE id = $1`,
    [id],
  );
}

describe("undecryptable encrypted field", () => {
  test("list serves both rows; only the broken row's field is null", async () => {
    const goodId = await createNote("good", "plain-good");
    const brokenId = await createNote("broken", "plain-broken");
    await corruptStoredSecret(brokenId);

    const list = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      LIST,
      { limit: 10 },
      admin,
    );
    const byId = new Map(list.rows.map((r) => [r["id"], r]));
    expect(byId.size).toBe(2);
    expect(byId.get(goodId)?.["secret"]).toBe("plain-good");
    expect(byId.get(goodId)?.["requiredSecret"]).toBe("required-plain-good");
    expect(byId.get(brokenId)?.["secret"]).toBeNull();
    expect(byId.get(brokenId)?.["requiredSecret"]).toBeNull();
    expect(byId.get(brokenId)?.["title"]).toBe("broken");
    expect(JSON.stringify(list)).not.toContain("not-an-envelope");
  });

  test("detail of the broken row answers with the field null instead of failing", async () => {
    const brokenId = await createNote("broken", "plain-broken");
    await corruptStoredSecret(brokenId);

    const row = await stack.http.queryOk<Record<string, unknown>>(DETAIL, { id: brokenId }, admin);
    expect(row["title"]).toBe("broken");
    expect(row["secret"]).toBeNull();
    expect(row["requiredSecret"]).toBeNull();
  });
});

// A list filter on a secret/encrypted/personal field would turn hit and count into a value oracle
// (a prefix oracle for legacy plaintext rows). Equality on a blind-indexed personal field is the
// one filter that works; a sort on such a field falls back to id order instead of failing.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
} from "../../crypto/index.js";
import { defineFeature } from "../../engine/define-feature.js";
import { createEntity, createTextField } from "../../engine/factories.js";
import { eventsTable } from "../../event-store/index.js";
import { TestUsers } from "../../seeding/seed-users.js";
import { buildEntityTable } from "../table-builder.js";

const vaultEntity = createEntity({
  table: "fs_vault_entries",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    apiKey: createTextField({ personal: "tenant", find: "secret", required: true }),
    email: createTextField({ personal: "tenant", find: "exact", required: true }),
  },
});

const vaultTable = buildEntityTable("entry", vaultEntity);

const CREATE = "vault:write:entry:create";
const LIST = "vault:query:entry:list";

const vaultFeature = defineFeature("vault", (r) => {
  r.crud("entry", vaultEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin"] } },
  });
});

type ListResult = {
  readonly rows: readonly { readonly id: string; readonly title: string }[];
  readonly total?: number;
};

describe("list() rejects filters that probe stored ciphertext", () => {
  let stack: TestStack;
  const admin = TestUsers.admin;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [vaultFeature] });
    await unsafeCreateEntityTable(stack.db, vaultEntity);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    configureBlindIndexKey(Buffer.alloc(32, 7).toString("base64"));
    await resetTestTables(stack.db, [eventsTable, vaultTable]);
  });

  afterEach(() => {
    resetPiiSubjectKmsForTests();
    resetBlindIndexKeyForTests();
  });

  async function seed(title: string, apiKey: string, email: string): Promise<string> {
    const created = await stack.http.writeOk<{ id: string }>(
      CREATE,
      { title, apiKey, email },
      admin,
    );
    return created.id;
  }

  async function expectNotFilterable(payload: Record<string, unknown>, field: string) {
    const err = await stack.http.queryErr(LIST, payload, admin);
    expect(err.httpStatus).toBe(400);
    expect(err.code).toBe("validation_error");
    expect(err.details).toMatchObject({
      fields: [{ path: `filter.${field}`, code: "field_not_filterable" }],
    });
  }

  test("a filter on a secret field is rejected, whatever the op", async () => {
    await seed("A", "key-alpha", "a@example.com");

    await expectNotFilterable(
      { filter: { field: "apiKey", op: "eq", value: "key-alpha" } },
      "apiKey",
    );
    await expectNotFilterable(
      { filters: [{ field: "apiKey", op: "in", value: ["key-alpha"] }] },
      "apiKey",
    );
    await expectNotFilterable({ filter: { field: "apiKey", op: "gt", value: "key-" } }, "apiKey");
  });

  test("equality on a blind-indexed personal field finds the row", async () => {
    await seed("A", "key-alpha", "a@example.com");
    await seed("B", "key-beta", "b@example.com");

    const result = await stack.http.queryOk<ListResult>(
      LIST,
      { totalCount: true, filter: { field: "email", op: "eq", value: "b@example.com" } },
      admin,
    );

    expect(result.rows.map((row) => row.title)).toEqual(["B"]);
    expect(result.total).toBe(1);
  });

  test("every other op on a blind-indexed personal field is rejected", async () => {
    await seed("A", "key-alpha", "a@example.com");

    await expectNotFilterable({ filter: { field: "email", op: "gt", value: "a" } }, "email");
    await expectNotFilterable(
      { filter: { field: "email", op: "in", value: ["a@example.com"] } },
      "email",
    );
    await expectNotFilterable({ filter: { field: "email", op: "ne", value: "x" } }, "email");
  });

  test("a plain field filters as before and unknown fields are still dropped", async () => {
    await seed("A", "key-alpha", "a@example.com");
    await seed("B", "key-beta", "b@example.com");

    const plain = await stack.http.queryOk<ListResult>(
      LIST,
      { filter: { field: "title", op: "eq", value: "A" } },
      admin,
    );
    const unknown = await stack.http.queryOk<ListResult>(
      LIST,
      { filter: { field: "doesNotExist", op: "eq", value: "x" } },
      admin,
    );

    expect(plain.rows.map((row) => row.title)).toEqual(["A"]);
    expect(unknown.rows).toHaveLength(2);
  });

  test("a sort on a secret or personal field answers 200 in id order", async () => {
    const first = await seed("First", "zzz", "z@example.com");
    const second = await seed("Second", "aaa", "a@example.com");

    for (const sort of ["apiKey", "email"]) {
      const result = await stack.http.queryOk<ListResult>(
        LIST,
        { sort, sortDirection: "desc" },
        admin,
      );
      expect(result.rows.map((row) => row.id)).toEqual([first, second]);
    }
  });
});

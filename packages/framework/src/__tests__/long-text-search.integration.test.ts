// longText `find: "fuzzy"`: the decrypted body goes into the search index; list search then runs
// under the same tenant, ownership and soft-delete rules as any other list.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "../crypto/index.ts";
import {
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
  selectMany,
} from "../db/index.ts";
import {
  createEntity,
  createLongTextField,
  createTextField,
  defineEntityQueryHandler,
  defineEntityWriteHandler,
  defineFeature,
  from,
} from "../engine/index.ts";
import type { SessionUser } from "../engine/types/index.ts";
import { createTestUser, TestUsers, testTenantId } from "../seeding/seed-users.ts";

const tenant = testTenantId(1);

const memoEntity = createEntity({
  table: "longtext_search_memos",
  softDelete: true,
  fields: {
    ownerId: createTextField({ personal: false, reason: "test_fixture", required: true }),
    body: createLongTextField({ personal: "tenant", find: "fuzzy", required: true }),
  },
  access: {
    read: { Admin: "all", Member: from("user:id", "ownerId") },
    write: { Admin: "all", Member: from("user:id", "ownerId") },
  },
});

const memoTable = buildEntityTable("memo", memoEntity);

const roles = ["Admin", "Member"] as const;
const feature = defineFeature("ltsearch", (r) => {
  r.entity({ name: "memo", ...memoEntity });
  for (const verb of ["create", "delete", "restore"] as const) {
    r.writeHandler(
      defineEntityWriteHandler(`memo:${verb}`, memoEntity, { access: { roles: [...roles] } }),
    );
  }
  r.queryHandler(
    defineEntityQueryHandler("memo:list", memoEntity, { access: { roles: [...roles] } }),
  );
});

const admin: SessionUser = { ...TestUsers.admin, tenantId: tenant };
const alice = createTestUser({
  id: "33333333-0000-4000-8000-000000000001",
  tenantId: tenant,
  roles: ["Member"],
});
const bob = createTestUser({
  id: "33333333-0000-4000-8000-000000000002",
  tenantId: tenant,
  roles: ["Member"],
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [feature],
  });
  await unsafeCreateEntityTable(stack.db, memoEntity, "memo");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

type ListResult = { rows: Array<Record<string, unknown>> };

async function search(user: SessionUser, term: string, extra = {}): Promise<string[]> {
  await stack.eventDispatcher?.runOnce();
  const result = await stack.http.queryOk<ListResult>(
    "ltsearch:query:memo:list",
    { search: term, ...extra },
    user,
  );
  return result.rows.map((row) => String(row["id"]));
}

async function createMemo(owner: SessionUser, body: string): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "ltsearch:write:memo:create",
    { ownerId: owner.id, body },
    admin,
  );
  return created.id;
}

describe("longText find: fuzzy", () => {
  test("the registry lists the field as searchable", () => {
    expect(stack.registry.getSearchableFields("memo")).toEqual(["body"]);
  });

  test("a word deep inside a long body is found", async () => {
    const body = `${"filler ".repeat(40_000)}needleinhaystack`;
    const id = await createMemo(admin, body);
    expect(await search(admin, "needleinhaystack")).toEqual([id]);
  });

  test("list search shows each user only their own rows, admin sees all", async () => {
    const aliceId = await createMemo(alice, "ownershipword from alice");
    const bobId = await createMemo(bob, "ownershipword from bob");
    expect(await search(alice, "ownershipword")).toEqual([aliceId]);
    expect(await search(bob, "ownershipword")).toEqual([bobId]);
    expect((await search(admin, "ownershipword")).sort()).toEqual([aliceId, bobId].sort());
  });

  test("soft delete takes the row out of the search, restore brings it back, purge keeps it out", async () => {
    const id = await createMemo(admin, "lifecycleword");
    expect(await search(admin, "lifecycleword")).toEqual([id]);

    await stack.http.writeOk("ltsearch:write:memo:delete", { id }, admin);
    expect(await search(admin, "lifecycleword")).toEqual([]);

    await stack.http.writeOk("ltsearch:write:memo:restore", { id }, admin);
    expect(await search(admin, "lifecycleword")).toEqual([id]);

    await stack.http.writeOk("ltsearch:write:memo:delete", { id }, admin);
    // The retention job calls executor.forget on rows past their grace period.
    const purged = await createEventStoreExecutor(memoTable, memoEntity, {
      entityName: "memo",
    }).forget(
      { id },
      admin,
      createTenantDb({
        db: stack.db,
        tenantId: tenant,
        mode: "system",
        reason: "test purges an expired soft-deleted row like soft-delete-cleanup",
      }),
    );
    expect(purged.isSuccess).toBe(true);
    expect(await selectMany(stack.db, memoTable, { id })).toHaveLength(0);
    expect(await search(admin, "lifecycleword")).toEqual([]);
    expect(await stack.search.search(tenant, "lifecycleword", { filterType: "memo" })).toEqual([]);
  });
});

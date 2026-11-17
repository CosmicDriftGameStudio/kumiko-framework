// An update that changes no searchable field must not rebuild the search document; an entity
// with a search payload extension still reindexes on every update, because the extension may
// read anything.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createEntity, createTextField, defineFeature } from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

function memoFields() {
  return {
    label: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      maxLength: 100,
      searchable: true,
    }),
    status: createTextField({ personal: false, reason: "test_fixture", maxLength: 50 }),
  };
}

const memoEntity = createEntity({ table: "read_update_relevance_memos", fields: memoFields() });
const memoExtEntity = createEntity({
  table: "read_update_relevance_memo_exts",
  fields: memoFields(),
});

const writeAccess = { access: { roles: ["Admin"] } } as const;
const readAccess = { access: { roles: ["Admin"] } } as const;

const relevanceFeature = defineFeature("update-relevance", (r) => {
  r.entity({ name: "memo", ...memoEntity });
  const memoExt = r.entity({ name: "memoExt", ...memoExtEntity });
  r.searchPayloadExtension(memoExt, ({ state }) => ({ extIndexed: state["label"] }));
  r.crud("memo", memoEntity, {
    write: writeAccess,
    read: readAccess,
    verbs: { restore: false },
    registerEntity: false,
  });
  r.crud("memoExt", memoExtEntity, {
    write: writeAccess,
    read: readAccess,
    verbs: { restore: false },
    registerEntity: false,
  });
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [relevanceFeature],
    searchConfig: {
      tenantId: admin.tenantId,
      searchableFields: ["label", "extIndexed"],
      rankingFields: ["label", "extIndexed"],
    },
  });
  await unsafeCreateEntityTable(stack.db, memoEntity, "memo");
  await unsafeCreateEntityTable(stack.db, memoExtEntity, "memoExt");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack, [
    "read_update_relevance_memos",
    "read_update_relevance_memo_exts",
  ]);
});

type Written = { id: string; data: { version: number } };

async function hitIds(term: string, entityType: string): Promise<string[]> {
  const hits = await stack.search.search(admin.tenantId, term, { filterType: entityType });
  return hits.map((h) => String(h.entityId));
}

describe("search consumer: update relevance", () => {
  test("an update changing only a non-searchable field leaves the index untouched", async () => {
    const created = await stack.http.writeOk<Written>(
      "update-relevance:write:memo:create",
      { label: "alpha-memo", status: "open" },
      admin,
    );
    await stack.eventDispatcher?.runOnce();
    expect(await hitIds("alpha-memo", "memo")).toContain(created.id);

    await stack.search.remove(admin.tenantId, "memo", created.id);
    expect(await hitIds("alpha-memo", "memo")).toHaveLength(0);

    const updated = await stack.http.writeOk<Written>(
      "update-relevance:write:memo:update",
      { id: created.id, version: created.data.version, changes: { status: "closed" } },
      admin,
    );
    await stack.eventDispatcher?.runOnce();
    expect(await hitIds("alpha-memo", "memo")).toHaveLength(0);

    await stack.http.writeOk<Written>(
      "update-relevance:write:memo:update",
      { id: created.id, version: updated.data.version, changes: { label: "beta-memo" } },
      admin,
    );
    await stack.eventDispatcher?.runOnce();
    expect(await hitIds("beta-memo", "memo")).toContain(created.id);
  });

  test("an entity with a search payload extension reindexes on every update", async () => {
    const created = await stack.http.writeOk<Written>(
      "update-relevance:write:memoExt:create",
      { label: "gamma-memo", status: "open" },
      admin,
    );
    await stack.eventDispatcher?.runOnce();
    expect(await hitIds("gamma-memo", "memoExt")).toContain(created.id);

    await stack.search.remove(admin.tenantId, "memoExt", created.id);
    expect(await hitIds("gamma-memo", "memoExt")).toHaveLength(0);

    await stack.http.writeOk<Written>(
      "update-relevance:write:memoExt:update",
      { id: created.id, version: created.data.version, changes: { status: "closed" } },
      admin,
    );
    await stack.eventDispatcher?.runOnce();
    expect(await hitIds("gamma-memo", "memoExt")).toContain(created.id);
  });
});

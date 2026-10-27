import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { TestUsers } from "../../seeding/seed-users.ts";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createTextField, createTimestampField } from "../factories.ts";

const leadEntity = createEntity({
  table: "sort_nulls_leads",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    receivedAt: createTimestampField({ sortable: true, sortNulls: "last" }),
    seenAt: createTimestampField({ sortable: true }),
  },
});

const leadFeature = defineFeature("sort-nulls", (r) => {
  r.crud("lead", leadEntity, {
    write: { access: { roles: ["User"] } },
    read: { access: { roles: ["User"] } },
  });
});

const CREATE = "sort-nulls:write:lead:create";
const LIST = "sort-nulls:query:lead:list";

type ListPage = {
  readonly rows: readonly { readonly name: string }[];
  readonly nextCursor: string | null;
};

describe("sortNulls on a sortable field", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [leadFeature] });
    await unsafeCreateEntityTable(stack.db, leadEntity);
    const leads = [
      { name: "manual-1" },
      { name: "old", receivedAt: "2026-01-01T00:00:00Z", seenAt: "2026-01-01T00:00:00Z" },
      { name: "manual-2" },
      { name: "new", receivedAt: "2026-03-01T00:00:00Z", seenAt: "2026-03-01T00:00:00Z" },
      { name: "mid", receivedAt: "2026-02-01T00:00:00Z", seenAt: "2026-02-01T00:00:00Z" },
    ];
    for (const lead of leads) await stack.http.writeOk(CREATE, lead, TestUsers.user);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  async function pagedNames(sort: string, sortDirection: "asc" | "desc"): Promise<string[]> {
    const names: string[] = [];
    let cursor: string | null = null;
    do {
      const page: ListPage = await stack.http.queryOk<ListPage>(
        LIST,
        { limit: 2, sort, sortDirection, ...(cursor !== null && { cursor }) },
        TestUsers.user,
      );
      names.push(...page.rows.map((row) => row.name));
      cursor = page.nextCursor;
    } while (cursor !== null);
    return names;
  }

  test('"last" keeps rows without a value at the end descending, across cursor pages', async () => {
    const names = await pagedNames("receivedAt", "desc");

    expect(names.slice(0, 3)).toEqual(["new", "mid", "old"]);
    expect([...names.slice(3)].sort()).toEqual(["manual-1", "manual-2"]);
  });

  test('"last" keeps rows without a value at the end ascending', async () => {
    const names = await pagedNames("receivedAt", "asc");

    expect(names.slice(0, 3)).toEqual(["old", "mid", "new"]);
    expect([...names.slice(3)].sort()).toEqual(["manual-1", "manual-2"]);
  });

  test("without sortNulls descending puts rows without a value first (Postgres default)", async () => {
    const names = await pagedNames("seenAt", "desc");

    expect([...names.slice(0, 2)].sort()).toEqual(["manual-1", "manual-2"]);
    expect(names.slice(2)).toEqual(["new", "mid", "old"]);
  });
});

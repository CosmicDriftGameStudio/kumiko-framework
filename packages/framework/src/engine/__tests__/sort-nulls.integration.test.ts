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
  name: "lead",
  table: "sort_nulls_leads",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    receivedAt: createTimestampField({ sortable: true, sortNulls: "last" }),
    seenAt: createTimestampField({ sortable: true }),
    firstSeenAt: createTimestampField({ sortable: true, sortNulls: "first" }),
  },
});

const leadFeature = defineFeature("sort-nulls", (r) => {
  r.crud(leadEntity, {
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
      {
        name: "old",
        receivedAt: "2026-01-01T00:00:00Z",
        seenAt: "2026-01-01T00:00:00Z",
        firstSeenAt: "2026-01-01T00:00:00Z",
      },
      { name: "manual-2" },
      {
        name: "new",
        receivedAt: "2026-03-01T00:00:00Z",
        seenAt: "2026-03-01T00:00:00Z",
        firstSeenAt: "2026-03-01T00:00:00Z",
      },
      {
        name: "mid",
        receivedAt: "2026-02-01T00:00:00Z",
        seenAt: "2026-02-01T00:00:00Z",
        firstSeenAt: "2026-02-01T00:00:00Z",
      },
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

  test('"first" keeps rows without a value at the start ascending, across cursor pages', async () => {
    const names = await pagedNames("firstSeenAt", "asc");

    expect([...names.slice(0, 2)].sort()).toEqual(["manual-1", "manual-2"]);
    expect(names.slice(2)).toEqual(["old", "mid", "new"]);
  });

  test("the insertedAt base column sorts newest first across cursor pages", async () => {
    const names = await pagedNames("insertedAt", "desc");

    expect(names).toEqual(["mid", "new", "manual-2", "old", "manual-1"]);
  });
});

const burstEntity = createEntity({
  name: "burst",
  table: "sort_nulls_bursts",
  fields: { name: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});

const burstFeature = defineFeature("sort-burst", (r) => {
  r.crud(burstEntity, {
    write: { access: { roles: ["User"] } },
    read: { access: { roles: ["User"] } },
  });
});

type BurstRow = { readonly id: string; readonly insertedAt: string };
type BurstPage = { readonly rows: readonly BurstRow[]; readonly nextCursor: string | null };

// Code-unit order, as Postgres orders uuids and ISO timestamps with a fixed offset.
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Rows created in one burst share inserted_at values; a cursor that dropped precision would
// skip or repeat rows at those ties.
describe("insertedAt cursor over rows created in one burst", () => {
  const BURST_SIZE = 40;
  const BURST_LIST = "sort-burst:query:burst:list";
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [burstFeature] });
    await unsafeCreateEntityTable(stack.db, burstEntity);
    await Promise.all(
      Array.from({ length: BURST_SIZE }, (_, index) =>
        stack.http.writeOk(
          "sort-burst:write:burst:create",
          { name: `burst-${index}` },
          TestUsers.user,
        ),
      ),
    );
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("limit 1 pages visit every row once, ordered by inserted_at desc then id", async () => {
    const all = await stack.http.queryOk<BurstPage>(
      BURST_LIST,
      { limit: 200, sort: "insertedAt", sortDirection: "desc" },
      TestUsers.user,
    );
    const expected = [...all.rows]
      .sort((a, b) =>
        a.insertedAt === b.insertedAt
          ? compareText(a.id, b.id)
          : compareText(b.insertedAt, a.insertedAt),
      )
      .map((row) => row.id);

    const paged: string[] = [];
    let cursor: string | null = null;
    do {
      const page: BurstPage = await stack.http.queryOk<BurstPage>(
        BURST_LIST,
        { limit: 1, sort: "insertedAt", sortDirection: "desc", ...(cursor !== null && { cursor }) },
        TestUsers.user,
      );
      paged.push(...page.rows.map((row) => row.id));
      cursor = page.nextCursor;
    } while (cursor !== null && paged.length <= BURST_SIZE);

    expect(new Set(paged).size).toBe(BURST_SIZE);
    expect(paged).toEqual(expected);
    expect(all.rows.map((row) => row.id)).toEqual(expected);
  });
});

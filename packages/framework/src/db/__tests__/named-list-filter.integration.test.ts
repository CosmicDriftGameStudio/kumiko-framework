import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { defineFeature } from "../../engine/define-feature.ts";
import { createEntity, createTextField } from "../../engine/factories.ts";
import { eventsTable } from "../../event-store/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

let pinnedIds: string[] = [];

const ticketEntity = createEntity({
  table: "nlf_tickets",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    status: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      filterable: true,
    }),
  },
  namedFilters: {
    open: { filters: () => [{ field: "status", op: "eq", value: "open" }] },
    pinned: {
      filters: async () => [{ field: "id", op: "in", value: pinnedIds }],
    },
    typo: { filters: () => [{ field: "statuss", op: "eq", value: "open" }] },
    adminOnly: {
      access: { roles: ["Admin"] },
      filters: () => [{ field: "status", op: "eq", value: "closed" }],
    },
  },
});

const ticketFeature = defineFeature("nlf", (r) => {
  r.crud("ticket", ticketEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  });
});

const LIST = "nlf:query:ticket:list";
const CREATE = "nlf:write:ticket:create";

type ListResult = {
  readonly rows: readonly { readonly id: string; readonly title: string }[];
  readonly total?: number;
};

type AggregateResult = { readonly groups: readonly { readonly count: number }[] };

describe("named list filters", () => {
  let stack: TestStack;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    stack = await setupTestStack({ features: [ticketFeature] });
    await unsafeCreateEntityTable(stack.db, ticketEntity);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    await resetTestTables(stack.db, [eventsTable, "nlf_tickets"]);
    for (const [title, status] of [
      ["A", "open"],
      ["B", "open"],
      ["C", "closed"],
    ] as const) {
      const created = await stack.http.writeOk<{ id: string }>(
        CREATE,
        { title, status },
        TestUsers.admin,
      );
      ids[title] = created.id;
    }
    pinnedIds = [ids["A"] ?? "", ids["C"] ?? ""];
  });

  const titles = (r: ListResult): string[] => r.rows.map((row) => row.title).sort();

  test("plain column filter narrows rows and total", async () => {
    const r = await stack.http.queryOk<ListResult>(
      LIST,
      { namedFilter: "open", totalCount: true, limit: 50 },
      TestUsers.admin,
    );
    expect(titles(r)).toEqual(["A", "B"]);
    expect(r.total).toBe(2);
  });

  test("async resolver filter narrows by resolved ids", async () => {
    const r = await stack.http.queryOk<ListResult>(
      LIST,
      { namedFilter: "pinned", totalCount: true, limit: 50 },
      TestUsers.admin,
    );
    expect(titles(r)).toEqual(["A", "C"]);
    expect(r.total).toBe(2);
  });

  test("combined with a facet filter the total stays consistent", async () => {
    const r = await stack.http.queryOk<ListResult>(
      LIST,
      {
        namedFilter: "pinned",
        filters: [{ field: "status", op: "eq", value: "open" }],
        totalCount: true,
        limit: 50,
      },
      TestUsers.admin,
    );
    expect(titles(r)).toEqual(["A"]);
    expect(r.total).toBe(1);
  });

  test("aggregate path honors namedFilter", async () => {
    const r = await stack.http.queryOk<AggregateResult>(
      LIST,
      { namedFilter: "open", aggregate: { measures: [] } },
      TestUsers.admin,
    );
    expect(r.groups[0]?.count).toBe(2);
  });

  test("unknown name is a validation error on namedFilter", async () => {
    const err = await stack.http.queryErr(LIST, { namedFilter: "nope" }, TestUsers.admin);
    expect(err.code).toBe("validation_error");
    expect(JSON.stringify(err)).toContain("namedFilter");
  });

  test("inherited object keys are not named filters", async () => {
    const err = await stack.http.queryErr(LIST, { namedFilter: "constructor" }, TestUsers.admin);
    expect(err.code).toBe("validation_error");
  });

  test("role-restricted filter is forbidden for other roles and works for the allowed role", async () => {
    const err = await stack.http.queryErr(LIST, { namedFilter: "adminOnly" }, TestUsers.user);
    expect(err.httpStatus).toBe(403);
    const r = await stack.http.queryOk<ListResult>(
      LIST,
      { namedFilter: "adminOnly", totalCount: true },
      TestUsers.admin,
    );
    expect(titles(r)).toEqual(["C"]);
    expect(r.total).toBe(1);
  });

  test("a condition on an unknown field fails closed instead of listing every row", async () => {
    const err = await stack.http.queryErr(LIST, { namedFilter: "typo" }, TestUsers.admin);
    expect(err.httpStatus).toBe(500);
  });

  test("empty id list yields zero rows and total 0", async () => {
    pinnedIds = [];
    const r = await stack.http.queryOk<ListResult>(
      LIST,
      { namedFilter: "pinned", totalCount: true, limit: 50 },
      TestUsers.admin,
    );
    expect(r.rows).toHaveLength(0);
    expect(r.total).toBe(0);
  });
});

// aggregate on the entity list query: groups and measures are computed in SQL over the same WHERE
// as the rows, so what a table shows per group always adds up to what the list itself returns.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import type { EntityId } from "@cosmicdrift/kumiko-types/identifiers";

import { eventsTable } from "../../event-store/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import {
  type AggResult,
  aggFeature,
  CREATE_CUSTOMER,
  CREATE_ORDER,
  customerEntity,
  LIST_ORDERS,
  orderEntity,
} from "./list-aggregate-fixture.ts";

function eur(value: number): { currency: string; value: number } {
  return { currency: "EUR", value };
}

type ListResult = { readonly rows: readonly { readonly id: string }[]; readonly total?: number };

describe("list aggregate", () => {
  let stack: TestStack;
  const admin = TestUsers.admin;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [aggFeature] });
    await unsafeCreateEntityTable(stack.db, customerEntity);
    await unsafeCreateEntityTable(stack.db, orderEntity);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    await resetTestTables(stack.db, [eventsTable, "agg_orders", "agg_customers"]);
  });

  async function order(fields: Record<string, unknown>, owner = admin.id): Promise<string> {
    const res = await stack.http.writeOk<{ id: string }>(
      CREATE_ORDER,
      { ownerId: owner, ...fields },
      admin,
    );
    return res.id;
  }

  async function seedMixed(): Promise<void> {
    await order({
      title: "alpha",
      status: "open",
      qty: 2,
      amount: { amount: 10.5, currency: "EUR" },
    });
    await order({
      title: "alpha two",
      status: "open",
      qty: 4,
      amount: { amount: 20, currency: "EUR" },
    });
    await order({
      title: "beta",
      status: "paid",
      qty: 10,
      amount: { amount: 1.25, currency: "EUR" },
    });
    await order({ title: "no status", qty: 1 });
  }

  test("groups and sums equal the rows the list returns for the same payload", async () => {
    await seedMixed();
    const filter = { field: "qty", op: "gte", value: 2 };

    const list = await stack.http.queryOk<ListResult>(
      LIST_ORDERS,
      { limit: 50, totalCount: true, filter },
      admin,
    );
    const agg = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      {
        filter,
        aggregate: {
          groupBy: "status",
          measures: [
            { field: "qty", kind: "sum" },
            { field: "qty", kind: "avg" },
            { field: "amount", kind: "sum" },
            { field: "amount", kind: "max" },
          ],
        },
      },
      admin,
    );

    expect(agg.groups.reduce((n, g) => n + g.count, 0)).toBe(list.total ?? -1);
    expect(agg.groups).toEqual([
      { key: "open", count: 2, measures: [6, 3, [eur(3050)], [eur(2000)]] },
      { key: "paid", count: 1, measures: [10, 10, [eur(125)], [eur(125)]] },
    ]);
  });

  test("without groupBy the answer is one summary group with a null key", async () => {
    await seedMixed();
    const agg = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      { aggregate: { measures: [{ field: "qty", kind: "sum" }] } },
      admin,
    );
    expect(agg.groups).toEqual([{ key: null, count: 4, measures: [17] }]);
  });

  test("an empty result set gives no groups, or a zero summary group when ungrouped", async () => {
    const none = { filter: { field: "qty", op: "gt", value: 999 } };
    const grouped = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      { ...none, aggregate: { groupBy: "status", measures: [{ field: "qty", kind: "sum" }] } },
      admin,
    );
    const ungrouped = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      {
        ...none,
        aggregate: {
          measures: [
            { field: "qty", kind: "sum" },
            { field: "qty", kind: "count" },
            { field: "qty", kind: "min" },
          ],
        },
      },
      admin,
    );
    expect(grouped.groups).toEqual([]);
    expect(ungrouped.groups).toEqual([{ key: null, count: 0, measures: [0, 0, null] }]);
  });

  test("a row without a value forms the null group, sorted last", async () => {
    await seedMixed();
    const agg = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      { aggregate: { groupBy: "status", measures: [] } },
      admin,
    );
    expect(agg.groups.map((g) => g.key)).toEqual(["open", "paid", null]);
  });

  test("search narrows the groups like it narrows the rows", async () => {
    await seedMixed();
    const rows = await stack.http.queryOk<{ rows: { id: string; title: string }[] }>(
      LIST_ORDERS,
      {},
      admin,
    );
    for (const row of rows.rows) {
      await stack.search.index(admin.tenantId, {
        entityType: "order",
        entityId: row.id as EntityId,
        weight: 1,
        fields: { title: row.title },
      });
    }
    const search = "alpha";
    const list = await stack.http.queryOk<ListResult>(
      LIST_ORDERS,
      { search, totalCount: true },
      admin,
    );
    const agg = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      { search, aggregate: { measures: [] } },
      admin,
    );
    expect(list.total).toBe(2);
    expect(agg.groups).toEqual([{ key: null, count: 2, measures: [] }]);
    const miss = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      { search: "zzz-nothing", aggregate: { groupBy: "status", measures: [] } },
      admin,
    );
    expect(miss.groups).toEqual([]);
  });

  test("the entity read ownership applies to groups exactly as to rows", async () => {
    await order({ title: "mine", status: "open", qty: 5 }, TestUsers.user.id);
    await order({ title: "theirs", status: "open", qty: 7 });
    const list = await stack.http.queryOk<ListResult>(
      LIST_ORDERS,
      { totalCount: true },
      TestUsers.user,
    );
    const agg = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      { aggregate: { groupBy: "status", measures: [{ field: "qty", kind: "sum" }] } },
      TestUsers.user,
    );
    expect(list.total).toBe(1);
    expect(agg.groups).toEqual([{ key: "open", count: 1, measures: [5] }]);
  });

  test("min and max are typed: timestamp as ISO, date as yyyy-mm-dd, money as minor units", async () => {
    await order({
      title: "a",
      placedAt: "2026-03-01T10:00:00Z",
      dueOn: "2026-04-02",
      amount: { amount: 12.34, currency: "EUR" },
    });
    await order({
      title: "b",
      placedAt: "2026-05-09T08:30:00.250Z",
      dueOn: "2026-01-15",
      amount: { amount: 99, currency: "EUR" },
    });
    const agg = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      {
        aggregate: {
          measures: [
            { field: "placedAt", kind: "min" },
            { field: "placedAt", kind: "max" },
            { field: "dueOn", kind: "min" },
            { field: "dueOn", kind: "max" },
            { field: "amount", kind: "min" },
            { field: "amount", kind: "avg" },
          ],
        },
      },
      admin,
    );
    expect(agg.groups[0]?.measures).toEqual([
      "2026-03-01T10:00:00.000Z",
      "2026-05-09T08:30:00.250Z",
      "2026-01-15",
      "2026-04-02",
      [eur(1234)],
      [eur(5567)],
    ]);
  });

  test("money measures answer one value per currency and never add across currencies", async () => {
    await order({ title: "a", status: "open", amount: { amount: 10, currency: "EUR" } });
    await order({ title: "b", status: "open", amount: { amount: 5, currency: "USD" } });
    await order({ title: "c", status: "open", amount: { amount: 2.5, currency: "EUR" } });
    await order({ title: "d", status: "paid", amount: { amount: 7, currency: "USD" } });
    await order({ title: "e", status: "paid" });
    const agg = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      {
        aggregate: {
          groupBy: "status",
          measures: [
            { field: "amount", kind: "sum" },
            { field: "amount", kind: "avg" },
            { field: "amount", kind: "count" },
          ],
        },
      },
      admin,
    );
    expect(agg.groups).toEqual([
      {
        key: "open",
        count: 3,
        measures: [
          [eur(1250), { currency: "USD", value: 500 }],
          [eur(625), { currency: "USD", value: 500 }],
          3,
        ],
      },
      {
        key: "paid",
        count: 2,
        measures: [[{ currency: "USD", value: 700 }], [{ currency: "USD", value: 700 }], 1],
      },
    ]);
    const filtered = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      {
        filters: [{ field: "status", op: "eq", value: "paid" }],
        aggregate: { measures: [{ field: "amount", kind: "sum" }] },
      },
      admin,
    );
    expect(filtered.groups).toEqual([
      { key: null, count: 2, measures: [[{ currency: "USD", value: 700 }]] },
    ]);
  });

  test("a money range filter in minor units narrows the rows and the sum alike", async () => {
    await order({ title: "low", status: "open", amount: { amount: 50, currency: "EUR" } });
    await order({ title: "mid", status: "open", amount: { amount: 100, currency: "EUR" } });
    await order({ title: "high", status: "open", amount: { amount: 150, currency: "EUR" } });
    await order({ title: "top", status: "open", amount: { amount: 200, currency: "EUR" } });
    const filters = [
      { field: "amount", op: "gte", value: 10000 },
      { field: "amount", op: "lte", value: 15000 },
    ];
    const list = await stack.http.queryOk<{
      readonly rows: readonly { readonly title: string }[];
      readonly total?: number;
    }>(LIST_ORDERS, { filters, sort: "title", totalCount: true }, admin);
    expect(list.rows.map((row) => row.title)).toEqual(["high", "mid"]);
    expect(list.total).toBe(2);
    const agg = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      { filters, aggregate: { measures: [{ field: "amount", kind: "sum" }] } },
      admin,
    );
    expect(agg.groups).toEqual([{ key: null, count: 2, measures: [[eur(25000)]] }]);
  });

  test("each group key filters the list back to exactly that group's rows", async () => {
    const acme = await stack.http.writeOk<{ id: string }>(CREATE_CUSTOMER, { name: "Acme" }, admin);
    await order({ title: "a", rush: true, dueOn: "2026-04-02", customerId: acme.id, qty: 1 });
    await order({ title: "b", rush: false, dueOn: "2026-04-02", qty: 2 });
    await order({ title: "c", dueOn: "2026-05-01", customerId: acme.id, qty: 3 });
    for (const groupBy of ["rush", "dueOn", "customerId", "placedAt"]) {
      const agg = await stack.http.queryOk<AggResult>(
        LIST_ORDERS,
        { aggregate: { groupBy, measures: [] } },
        admin,
      );
      for (const group of agg.groups) {
        const list = await stack.http.queryOk<ListResult>(
          LIST_ORDERS,
          { totalCount: true, filters: [{ field: groupBy, op: "eq", value: group.key }] },
          admin,
        );
        expect({ groupBy, key: group.key, rows: list.total }).toEqual({
          groupBy,
          key: group.key,
          rows: group.count,
        });
      }
    }
  });

  test("groupBy on a reference keys by id and labels by the target labelField", async () => {
    const acme = await stack.http.writeOk<{ id: string }>(CREATE_CUSTOMER, { name: "Acme" }, admin);
    await order({ title: "a", customerId: acme.id, qty: 1 });
    await order({ title: "b", customerId: acme.id, qty: 2 });
    await order({ title: "c", qty: 3 });
    const agg = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      { aggregate: { groupBy: "customerId", measures: [{ field: "qty", kind: "sum" }] } },
      admin,
    );
    expect(agg.groups).toEqual([
      { key: acme.id, label: "Acme", count: 2, measures: [3] },
      { key: null, label: null, count: 1, measures: [3] },
    ]);
  });

  test("more than 200 groups are cut to 200 and flagged truncated", async () => {
    const batch = Array.from({ length: 201 }, (_, i) => i);
    for (let i = 0; i < batch.length; i += 20) {
      await Promise.all(
        batch
          .slice(i, i + 20)
          .map((n) => order({ title: `t${n}`, category: `c${String(n).padStart(3, "0")}` })),
      );
    }
    const agg = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      { aggregate: { groupBy: "category", measures: [] } },
      admin,
    );
    expect(agg.groups).toHaveLength(200);
    expect(agg.truncated).toBe(true);
    expect(agg.groups[0]?.key).toBe("c000");
  });
});

// aggregate must not become a side channel around field-level read access: a field the caller may
// not read yields nothing (same as an unknown field), a row-dependent read rule restricts only the
// rows it hides, and ciphertext/secret fields and unsuitable types are refused.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { asRawClient } from "../../db/query.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import {
  type AggResult,
  aggFeature,
  CREATE_ORDER,
  customerEntity,
  LIST_ORDERS,
  orderEntity,
} from "./list-aggregate-fixture.ts";

describe("list aggregate field access", () => {
  let stack: TestStack;
  const admin = TestUsers.admin;
  const user = TestUsers.user;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [aggFeature] });
    await unsafeCreateEntityTable(stack.db, customerEntity);
    await unsafeCreateEntityTable(stack.db, orderEntity);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
    await asRawClient(stack.db).unsafe('DELETE FROM "agg_orders"');
    await asRawClient(stack.db).unsafe('DELETE FROM "agg_customers"');
  });

  async function order(fields: Record<string, unknown>, owner: string): Promise<void> {
    await stack.http.writeOk(CREATE_ORDER, { ownerId: owner, ...fields }, admin);
  }

  test("a measure on a field without read access is null, the same as an unknown field", async () => {
    await order({ title: "a", qty: 1, adminOnly: 50 }, user.id);
    const gated = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      { aggregate: { measures: [{ field: "adminOnly", kind: "sum" }] } },
      user,
    );
    const unknown = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      { aggregate: { measures: [{ field: "doesNotExist", kind: "sum" }] } },
      user,
    );
    expect(gated).toEqual(unknown);
    expect(gated.groups).toEqual([{ key: null, count: 1, measures: [null] }]);
    const allowed = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      { aggregate: { measures: [{ field: "adminOnly", kind: "sum" }] } },
      admin,
    );
    expect(allowed.groups[0]?.measures).toEqual([50]);
  });

  test("groupBy on an unreadable or unknown field gives no groups and no error", async () => {
    await order({ title: "a", adminOnly: 50 }, user.id);
    const gated = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      { aggregate: { groupBy: "adminOnly", measures: [] } },
      user,
    );
    const unknown = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      { aggregate: { groupBy: "doesNotExist", measures: [] } },
      user,
    );
    expect(gated.groups).toEqual([]);
    expect(unknown).toEqual(gated);
  });

  // The entity rule shows the user every row below (ownerId); only the field rule,
  // keyed on fieldOwnerId, decides which rows' values the user may read.
  test("a row-dependent read rule on the measure field sums only the rows the caller may read", async () => {
    await order({ title: "mine", rowOwnedQty: 5, fieldOwnerId: user.id }, user.id);
    await order({ title: "other", rowOwnedQty: 7, fieldOwnerId: admin.id }, user.id);
    const measures = [{ field: "rowOwnedQty", kind: "sum" }];
    const asUser = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      { aggregate: { measures } },
      user,
    );
    const asAdmin = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      { aggregate: { measures } },
      admin,
    );
    expect(asUser.groups).toEqual([{ key: null, count: 2, measures: [5] }]);
    expect(asAdmin.groups[0]?.measures).toEqual([12]);
  });

  test("rows hidden by a row-dependent groupBy rule do not fall into the real null group", async () => {
    await order({ title: "A", rowOwnedGroup: "g1", fieldOwnerId: user.id }, user.id);
    await order({ title: "B", fieldOwnerId: user.id }, user.id);
    await order({ title: "C", rowOwnedGroup: "hidden", fieldOwnerId: admin.id }, user.id);
    await order({ title: "D", fieldOwnerId: admin.id }, user.id);
    const aggregate = { groupBy: "rowOwnedGroup", measures: [] };
    const asUser = await stack.http.queryOk<AggResult>(LIST_ORDERS, { aggregate }, user);
    const asAdmin = await stack.http.queryOk<AggResult>(LIST_ORDERS, { aggregate }, admin);
    expect(asUser.groups.map((g) => [g.key, g.count])).toEqual([
      ["g1", 1],
      [null, 1],
    ]);
    expect(asAdmin.groups.map((g) => [g.key, g.count])).toEqual([
      ["g1", 1],
      ["hidden", 1],
      [null, 2],
    ]);
  });

  test("sensitive fields are refused with a validation error, as group and as measure", async () => {
    const asGroup = await stack.http.queryErr(
      LIST_ORDERS,
      { aggregate: { groupBy: "vaultKey", measures: [] } },
      admin,
    );
    const asMeasure = await stack.http.queryErr(
      LIST_ORDERS,
      { aggregate: { measures: [{ field: "vaultKey", kind: "count" }] } },
      admin,
    );
    expect(asGroup.httpStatus).toBe(400);
    expect(asGroup.code).toBe("validation_error");
    expect(asMeasure.httpStatus).toBe(400);
  });

  test("a measure the field type cannot take is refused", async () => {
    const sumOfText = await stack.http.queryErr(
      LIST_ORDERS,
      { aggregate: { measures: [{ field: "title", kind: "sum" }] } },
      admin,
    );
    const minOfText = await stack.http.queryErr(
      LIST_ORDERS,
      { aggregate: { measures: [{ field: "title", kind: "min" }] } },
      admin,
    );
    expect(sumOfText.httpStatus).toBe(400);
    expect(minOfText.httpStatus).toBe(400);
    const countOfText = await stack.http.queryOk<AggResult>(
      LIST_ORDERS,
      { aggregate: { measures: [{ field: "title", kind: "count" }] } },
      admin,
    );
    expect(countOfText.groups[0]?.measures).toEqual([0]);
  });

  test("a group field that cannot round-trip as a filter value is refused", async () => {
    const byMoney = await stack.http.queryErr(
      LIST_ORDERS,
      { aggregate: { groupBy: "amount", measures: [] } },
      admin,
    );
    expect(byMoney.httpStatus).toBe(400);
  });

  test("more than 20 measures fail schema validation", async () => {
    const measures = Array.from({ length: 21 }, () => ({ field: "qty", kind: "sum" }));
    const err = await stack.http.queryErr(LIST_ORDERS, { aggregate: { measures } }, admin);
    expect(err.httpStatus).toBe(400);
  });
});

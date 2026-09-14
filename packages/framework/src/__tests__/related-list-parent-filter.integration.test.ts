// A relatedList section with `parentFilter` sends the parent id as
// `payload.filter: { field, op: "eq", value: parentId }` instead of a
// bespoke top-level key (related-list-section.tsx) — proving it against the
// generic `<entity>:list` query end-to-end means proving `filter` and
// `search` combine correctly in the real executor, over real HTTP, exactly
// as the renderer's own request would look.
//
// Bun.SQL-only setup via setupTestStack.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityListHandler,
  defineFeature,
} from "../engine";
import { setupTestStack, type TestStack, TestUsers, unsafeCreateEntityTable } from "../stack";

const itemEntity = createEntity({
  table: "akte_items",
  fields: {
    name: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      searchable: true,
    }),
    orderId: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});

const ordersFeature = defineFeature("akteorders", (r) => {
  r.entity("item", itemEntity);
  r.writeHandler(defineEntityCreateHandler("item", itemEntity, { access: { roles: ["Admin"] } }));
  r.queryHandler(defineEntityListHandler("item", itemEntity, { access: { roles: ["Admin"] } }));
});

describe("relatedList parentFilter against the generic <entity>:list query", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [ordersFeature] });
    await unsafeCreateEntityTable(stack.db, itemEntity);

    await stack.http.writeOk(
      "akteorders:write:item:create",
      { name: "Alice Corp", orderId: "order-1" },
      TestUsers.admin,
    );
    await stack.http.writeOk(
      "akteorders:write:item:create",
      { name: "Bob LLC", orderId: "order-1" },
      TestUsers.admin,
    );
    await stack.http.writeOk(
      "akteorders:write:item:create",
      { name: "Alice Two", orderId: "order-2" },
      TestUsers.admin,
    );
    // Search indexing is async — drain the event dispatcher before any
    // query below relies on `search` finding these rows.
    await stack.eventDispatcher?.runOnce();
  });

  afterAll(() => stack.cleanup());

  test("filter: eq on the parent id returns only that parent's rows", async () => {
    const res = await stack.http.query(
      "akteorders:query:item:list",
      { filter: { field: "orderId", op: "eq", value: "order-1" } },
      TestUsers.admin,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { rows: Array<Record<string, unknown>> } };
    const names = body.data.rows.map((r) => r["name"]).sort();
    expect(names).toEqual(["Alice Corp", "Bob LLC"]);
  });

  test("filter combined with search narrows within the parent's own rows only", async () => {
    const res = await stack.http.query(
      "akteorders:query:item:list",
      { filter: { field: "orderId", op: "eq", value: "order-1" }, search: "alice" },
      TestUsers.admin,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { rows: Array<Record<string, unknown>> } };
    // "Alice Two" matches the search term but belongs to order-2 — the
    // parent filter must exclude it even though search alone would find it.
    expect(body.data.rows.map((r) => r["name"])).toEqual(["Alice Corp"]);
  });

  test("search alone (no filter) would find both Alice rows across parents — proves the filter is what narrows them", async () => {
    const res = await stack.http.query(
      "akteorders:query:item:list",
      { search: "alice" },
      TestUsers.admin,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { rows: Array<Record<string, unknown>> } };
    expect(body.data.rows.map((r) => r["name"]).sort()).toEqual(["Alice Corp", "Alice Two"]);
  });
});

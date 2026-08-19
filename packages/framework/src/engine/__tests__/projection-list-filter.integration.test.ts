// fw#2224: a projectionList screen can now declare `filter`/`facets`, but
// the wire contract that actually matters is the payload the query handler
// receives — `screen.filter`/facet-toggles reach the server as
// payload.filter/payload.filters (see kumiko-screen.tsx's ProjectionListBody
// queryPayload). This proves the server side of that contract over real
// HTTP: a query handler whose Zod schema accepts filter/filters (here the
// entity-list auto-CRUD handler, entityListSchema) genuinely narrows the
// returned rows — not just "the field is present in the payload".
//
// The bound query is a real entity-list handler (r.crud), the same one a
// projectionList screen would point `query` at to reuse another feature's
// list — see the registered "member-list" projectionList screen below,
// which pins that this is a realistic, boot-valid setup, not just a
// hand-rolled test handler.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "../../db/query";
import { setupTestStack, type TestStack, TestUsers, unsafeCreateEntityTable } from "../../stack";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";

const memberEntity = createEntity({
  table: "pl_filter_members",
  fields: {
    name: createTextField({ required: true }),
    status: createTextField({ required: true, filterable: true }),
  },
});

const LIST_QN = "roster:query:member:list";

const rosterFeature = defineFeature("roster", (r) => {
  r.crud("member", memberEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { openToAll: true } },
  });
  r.screen({
    id: "member-list",
    type: "projectionList",
    query: LIST_QN,
    columns: ["name", "status"],
    filter: { field: "status", op: "eq", value: "active" },
  });
  r.translations({
    keys: { "screen:member-list.title": { de: "Mitglieder", en: "Members" } },
  });
});

describe("projectionList filter — real query narrows real rows (fw#2224)", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [rosterFeature] });
    await unsafeCreateEntityTable(stack.db, memberEntity);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
    await asRawClient(stack.db).unsafe('DELETE FROM "pl_filter_members"');
  });

  async function seed(): Promise<void> {
    const CREATE = "roster:write:member:create";
    await stack.http.write(CREATE, { name: "Ada", status: "active" }, TestUsers.admin);
    await stack.http.write(CREATE, { name: "Grace", status: "active" }, TestUsers.admin);
    await stack.http.write(CREATE, { name: "Bob", status: "inactive" }, TestUsers.admin);
  }

  test("screen.filter's shape (payload.filter, op:eq) returns only matching rows", async () => {
    await seed();
    const result = await stack.http.queryOk<{
      readonly rows: readonly { readonly name: string; readonly status: string }[];
    }>(
      LIST_QN,
      { limit: 50, filter: { field: "status", op: "eq", value: "active" } },
      TestUsers.admin,
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.name).sort()).toEqual(["Ada", "Grace"]);
    expect(result.rows.every((r) => r.status === "active")).toBe(true);
  });

  test("a facet's shape (payload.filters, op:in) returns only matching rows", async () => {
    await seed();
    const result = await stack.http.queryOk<{
      readonly rows: readonly { readonly name: string; readonly status: string }[];
    }>(
      LIST_QN,
      { limit: 50, filters: [{ field: "status", op: "in", value: ["inactive"] }] },
      TestUsers.admin,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.name).toBe("Bob");
  });

  test("no filter — all rows return (control: proves the filter tests above actually narrow something)", async () => {
    await seed();
    const result = await stack.http.queryOk<{
      readonly rows: readonly { readonly name: string; readonly status: string }[];
    }>(LIST_QN, { limit: 50 }, TestUsers.admin);

    expect(result.rows).toHaveLength(3);
  });
});

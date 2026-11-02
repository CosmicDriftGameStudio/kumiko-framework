// A list aggregate counts rows before postQuery hooks run, so with a row-filtering hook it would
// report the hidden rows. It must be refused instead, and only results built by answerListAggregate
// count as aggregates (a handler returning `{ groups }` still passes through the hooks).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import type { PostQueryHookFn } from "@cosmicdrift/kumiko-types/hooks";
import * as z from "zod";
import {
  createEntity,
  createNumberField,
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const secretNoteEntity = createEntity({
  table: "agg_hook_notes",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    hidden: createNumberField(),
  },
});

const hideHiddenRows: PostQueryHookFn = async ({ rows }) => ({
  rows: rows.filter((row) => row["hidden"] !== 1),
});

const addMarker: PostQueryHookFn = async ({ rows }) => ({
  rows: rows.map((row) => ({ ...row, hooked: true })),
});

const openToAll = { openToAll: { reason: "test handler callable by any signed-in test user" } };

const feature = defineFeature("agghook", (r) => {
  const note = r.entity({ name: "note", ...secretNoteEntity });
  r.crud("note", secretNoteEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: openToAll },
  });
  r.hook({ type: "postQuery", target: { allOf: note }, handler: hideHiddenRows });
});

const lookalikeFeature = defineFeature("agglook", (r) => {
  const thing = r.entity({
    name: "thing",
    table: "agg_look_things",
    fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
  });
  r.queryHandler({
    name: "thing:stats",
    schema: z.object({}),
    handler: async () => ({ groups: [{ key: "a", count: 99, measures: [] }] }),
    access: openToAll,
  });
  r.hook({ type: "postQuery", target: { allOf: thing }, handler: addMarker });
});

describe("list aggregate vs postQuery hooks", () => {
  let stack: TestStack;
  const admin = TestUsers.admin;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [feature, lookalikeFeature] });
    await unsafeCreateEntityTable(stack.db, secretNoteEntity);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("an aggregate on an entity with a row-filtering postQuery hook is refused, not counted", async () => {
    await stack.http.writeOk("agghook:write:note:create", { title: "visible", hidden: 0 }, admin);
    await stack.http.writeOk("agghook:write:note:create", { title: "secret", hidden: 1 }, admin);

    const plain = await stack.http.queryOk<{ rows: unknown[] }>(
      "agghook:query:note:list",
      {},
      admin,
    );
    expect(plain.rows).toHaveLength(1);

    const res = await stack.http.query(
      "agghook:query:note:list",
      {
        aggregate: { measures: [] },
      },
      admin,
    );
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain('"count":2');
  });

  test("a hand-written handler returning { groups } still runs through the postQuery hooks", async () => {
    const res = await stack.http.query("agglook:query:thing:stats", {}, admin);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("hooked");
  });
});

// F1 postQuery-Hook integration test — verifies firing through the real
// dispatcher pipeline (handler-keyed + entity-keyed, order, shape-variants).
//
// Covers advisor-gaps from F1-self-review:
//   - integration test against real dispatcher (gap #1)
//   - order: handler-keyed fires BEFORE entity-keyed (gap #2)
//   - {rows}-shape (the most common case for list-handlers) (gap #3)
//
// Memory `feedback_no_fake_dispatcher`: real HTTP-Calls via setupTestStack,
// nicht createTestDispatcher.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import { createEntity, createTextField, defineFeature } from "../../engine";
import type { PostQueryHookFn } from "../../engine/types";
import { setupTestStack, type TestStack, TestUsers } from "../../stack";

// --- Fixture entity ---

const widgetEntity = createEntity({
  table: "read_post_query_widgets",
  fields: {
    name: createTextField({ required: true }),
  },
});

// --- Track hook-firing-order (module-level for test inspection) ---

const firingOrder: string[] = [];

// --- Feature with handler-keyed + entity-keyed postQuery-Hooks ---

const handlerKeyedHook: PostQueryHookFn = async ({ rows }) => {
  firingOrder.push("handler-keyed");
  return {
    rows: rows.map((row) => ({ ...row, viaHandler: true })),
  };
};

const entityKeyedHook: PostQueryHookFn = async ({ rows }) => {
  firingOrder.push("entity-keyed");
  return {
    rows: rows.map((row) => ({ ...row, viaEntity: true })),
  };
};

const postQueryFeature = defineFeature("postquerytest", (r) => {
  const widget = r.entity("widget", widgetEntity);

  // Returns 2 rows in {rows}-Shape (the dominant case for list-handlers)
  r.queryHandler(
    "widget:list",
    z.object({}),
    async () => ({
      rows: [
        { id: "w1", name: "Alpha" },
        { id: "w2", name: "Beta" },
      ],
      nextCursor: null,
    }),
    { access: { openToAll: true } },
  );

  // Handler-keyed: fires only for widget:list
  r.hook("postQuery", "widget:list", handlerKeyedHook);

  // Entity-keyed: fires for ALL query-handlers of widget-entity
  r.entityHook("postQuery", widget, entityKeyedHook);
});

// --- Single-object-result invariant fixtures ---
//
// A query handler that returns a plain object (not array, not {rows}) carries
// exactly one row through the hook pipeline. A hook that returns 0 or ≥2 rows
// for such a result used to be swallowed (`rows[0] ?? result`): 0 rows fell
// back to the unhooked original, ≥2 silently dropped the extras. Both now
// surface as a dispatcher error instead.

const gadgetEntity = createEntity({
  table: "read_post_query_gadgets",
  fields: { name: createTextField({ required: true }) },
});
const gizmoEntity = createEntity({
  table: "read_post_query_gizmos",
  fields: { name: createTextField({ required: true }) },
});

const dropRowHook: PostQueryHookFn = async () => ({ rows: [] });
const duplicateRowHook: PostQueryHookFn = async ({ rows }) => ({ rows: [...rows, ...rows] });

const singleObjectFeature = defineFeature("singleobjtest", (r) => {
  const gadget = r.entity("gadget", gadgetEntity);
  r.queryHandler("gadget:get", z.object({}), async () => ({ id: "g1", name: "Gadget" }), {
    access: { openToAll: true },
  });
  r.entityHook("postQuery", gadget, dropRowHook);

  const gizmo = r.entity("gizmo", gizmoEntity);
  r.queryHandler("gizmo:get", z.object({}), async () => ({ id: "z1", name: "Gizmo" }), {
    access: { openToAll: true },
  });
  r.entityHook("postQuery", gizmo, duplicateRowHook);
});

// --- Test stack ---

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [postQueryFeature, singleObjectFeature],
    systemHooks: [],
  });
});

afterAll(async () => {
  await stack.cleanup();
});

// --- Tests ---

describe("postQuery-Hook integration through dispatcher", () => {
  test("handler-keyed and entity-keyed hooks both fire, modify rows, in handler-then-entity order", async () => {
    firingOrder.length = 0;

    const result = await stack.http.queryOk<{
      rows: Array<{ id: string; name: string; viaHandler?: boolean; viaEntity?: boolean }>;
      nextCursor: string | null;
    }>("postquerytest:query:widget:list", {}, admin);

    // Both hooks fired
    expect(firingOrder).toEqual(["handler-keyed", "entity-keyed"]);

    // Both hooks' mutations land in the response
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      id: "w1",
      name: "Alpha",
      viaHandler: true,
      viaEntity: true,
    });
    expect(result.rows[1]).toMatchObject({
      id: "w2",
      name: "Beta",
      viaHandler: true,
      viaEntity: true,
    });

    // {rows}-Shape preserved through hook-pipeline
    expect(result.nextCursor).toBeNull();
  });
});

describe("single-object-result postQuery invariant: exactly one row", () => {
  test("hook returning 0 rows surfaces as 500 (not a silent fallback to the unhooked result)", async () => {
    const res = await stack.http.query("singleobjtest:query:gadget:get", {}, admin);
    expect(res.status).toBe(500);
  });

  test("hook returning ≥2 rows surfaces as 500 (not a silent truncation to the first)", async () => {
    const res = await stack.http.query("singleobjtest:query:gizmo:get", {}, admin);
    expect(res.status).toBe(500);
  });
});

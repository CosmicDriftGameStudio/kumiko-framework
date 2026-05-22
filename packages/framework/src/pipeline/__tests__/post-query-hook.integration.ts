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

import { afterAll, beforeAll, describe, expect, test } from "vitest";
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

// --- Test stack ---

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [postQueryFeature], systemHooks: [] });
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

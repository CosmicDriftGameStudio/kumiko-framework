// Pinst dass items via dispatch erstellbar sind, mit den Payload-Shapes
// die der Showcase-Seed nutzt — title/status/isDone/priority/dueDate/
// notes. Hat einen 500-Crash mit "Cannot parse: 2026-04-10" gefangen
// (type:"date" Schema-Drift zwischen Zod-Validator [YYYY-MM-DD] und
// dialect.toDriver [Temporal.Instant.from braucht ISO-datetime]). Der
// Test rennt jetzt beim CI mit, damit die Regression nicht wiederkommt.

import { createEventsTable } from "@kumiko/framework/event-store";
import {
  createEntityTable,
  setupTestStack,
  TestUsers,
  type TestStack,
} from "@kumiko/framework/testing";
import { afterAll, beforeAll, expect, test } from "vitest";
import { itemEntity } from "../features/items/schema";
import { itemsFeature } from "../features/items/feature";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [itemsFeature] });
  await createEventsTable(stack.db);
  await createEntityTable(stack.db, itemEntity, "item");
});

afterAll(async () => {
  await stack?.cleanup();
});

test("item:create akzeptiert Seed-Payload mit dueDate=YYYY-MM-DD", async () => {
  const result = await stack.http.writeOk<{ id: string }>(
    "showcase:write:item:create",
    {
      title: "Bug: fix auth (#1)",
      status: "draft",
      isDone: false,
      priority: 2,
      dueDate: "2026-04-25",
      notes: "",
    },
    TestUsers.admin,
  );
  expect(result.id).toBeDefined();
});

test("item:list returnt das angelegte item zurück", async () => {
  const list = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    "showcase:query:item:list",
    {},
    TestUsers.admin,
  );
  expect(list.rows.length).toBeGreaterThan(0);
});

test("item:list mit pagination-payload (limit + totalCount) liefert total", async () => {
  // pinst Tier-2.6d Server-Seite: totalCount: true → executor.list
  // macht extra COUNT-Query und gibt total mit. Der Pager im Renderer
  // hängt davon ab — ohne diese Server-Side wäre total stets undefined
  // und der Pager würde nie rendern.
  const list = await stack.http.queryOk<{
    rows: Array<Record<string, unknown>>;
    total?: number;
  }>("showcase:query:item:list", { limit: 50, totalCount: true }, TestUsers.admin);
  expect(list.total).toBeDefined();
  expect(typeof list.total).toBe("number");
});

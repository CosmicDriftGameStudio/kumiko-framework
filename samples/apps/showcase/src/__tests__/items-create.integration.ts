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
  type TestStack,
  TestUsers,
} from "@kumiko/framework/testing";
import { afterAll, beforeAll, expect, test } from "vitest";
import { itemsFeature } from "../features/items/feature";
import { itemEntity } from "../features/items/schema";

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

test("item:list mit screen-filter (Tier 2.7c): nur status=active zurück", async () => {
  // Pinst Tier-2.7c End-to-End: dispatcher payload mit `filter` gelangt
  // durch den Zod-Validator + executor.list WHERE-Builder. Pre-Tier-2.7c
  // hätte das Zod den filter rejected und der Server hätte status:400
  // statt einer gefilterten Liste geantwortet.
  await stack.http.writeOk(
    "showcase:write:item:create",
    {
      title: "active-1",
      status: "active",
      isDone: false,
      priority: 1,
      dueDate: "2026-05-01",
      notes: "",
    },
    TestUsers.admin,
  );
  await stack.http.writeOk(
    "showcase:write:item:create",
    {
      title: "draft-1",
      status: "draft",
      isDone: false,
      priority: 1,
      dueDate: "2026-05-01",
      notes: "",
    },
    TestUsers.admin,
  );

  const filtered = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    "showcase:query:item:list",
    { limit: 200, filter: { field: "status", op: "eq", value: "active" } },
    TestUsers.admin,
  );
  // Mindestens das eine "active-1" — andere Tests legen evtl. mehr an.
  expect(filtered.rows.length).toBeGreaterThan(0);
  // Aber KEINE drafts unter den results.
  expect(filtered.rows.every((r) => r["status"] === "active")).toBe(true);
});

test("item:delete via rowAction-Pfad: Default-Payload {id} reicht", async () => {
  // Pinst Tier-2.7a End-to-End: die Delete-Action im itemListScreen
  // schickt nur `{ id: row.id }` (kein expliziter payload-Builder im
  // Schema), und der server-side write-Handler akzeptiert das. Ohne
  // diesen Test würde ein Schema-Drift (z.B. delete-Handler erwartet
  // version-Feld) erst beim ersten Browser-Klick auffallen.
  const created = await stack.http.writeOk<{ id: string }>(
    "showcase:write:item:create",
    {
      title: "to-delete",
      status: "draft",
      isDone: false,
      priority: 1,
      dueDate: "2026-05-01",
      notes: "",
    },
    TestUsers.admin,
  );
  // Default-Payload ist exakt `{ id: row.id }` — pinst die Convention
  // dass der delete-Handler kein zusätzliches version-Feld verlangt.
  await stack.http.writeOk("showcase:write:item:delete", { id: created.id }, TestUsers.admin);
  const list = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    "showcase:query:item:list",
    { limit: 200 },
    TestUsers.admin,
  );
  // Soft-Delete-Default in createEntity: deleted rows aus list raus,
  // also ist die id nicht mehr drin.
  expect(list.rows.find((r) => r["id"] === created.id)).toBeUndefined();
});

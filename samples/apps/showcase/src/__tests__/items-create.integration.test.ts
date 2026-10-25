// Pins that items can be created via dispatch with the payload shapes
// the showcase seed uses — title/status/isDone/priority/dueDate/
// notes. Caught a 500 crash with "Cannot parse: 2026-04-10"
// (type:"date" schema drift between the Zod validator [YYYY-MM-DD] and
// dialect.toDriver [Temporal.Instant.from needs an ISO datetime]). The
// test now runs in CI so the regression does not come back.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { itemsFeature } from "../features/items/feature";
import { itemEntity } from "../features/items/schema";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [itemsFeature] });
  await unsafeCreateEntityTable(stack.db, itemEntity, "item");
});

afterAll(async () => {
  await stack?.cleanup();
});

test("item:create accepts seed payload with dueDate=YYYY-MM-DD", async () => {
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

test("item:list returns the created item", async () => {
  const list = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    "showcase:query:item:list",
    {},
    TestUsers.admin,
  );
  expect(list.rows.length).toBeGreaterThan(0);
});

test("item:list with pagination payload (limit + totalCount) returns total", async () => {
  // pins Tier-2.6d server side: totalCount: true → executor.list
  // runs an extra COUNT query and returns total. The pager in the renderer
  // depends on it — without this server side total would always be undefined
  // and the pager would never render.
  const list = await stack.http.queryOk<{
    rows: Array<Record<string, unknown>>;
    total?: number;
  }>("showcase:query:item:list", { limit: 50, totalCount: true }, TestUsers.admin);
  expect(list.total).toBeDefined();
  expect(typeof list.total).toBe("number");
});

// Tier-2.7c end to end: a dispatcher payload with `filter` goes through the
// Zod validator + the executor.list WHERE builder. Tests pin all 5 ops
// over the full HTTP path — pre-2.7c Zod would have rejected the filter
// and the server would have answered status:400 instead of a filtered list.
//
// Each test creates its own items with unique markers
// (priority values 100-104) so they are stable independent of other tests in
// the same suite. status="active"/"draft" is enough for eq/ne,
// priority for lt/gt/in.
test("filter eq (HTTP): status=active returns only active items", async () => {
  await stack.http.writeOk(
    "showcase:write:item:create",
    {
      title: "filter-eq-active",
      status: "active",
      isDone: false,
      priority: 100,
      dueDate: "2026-05-01",
      notes: "",
    },
    TestUsers.admin,
  );
  await stack.http.writeOk(
    "showcase:write:item:create",
    {
      title: "filter-eq-draft",
      status: "draft",
      isDone: false,
      priority: 100,
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
  expect(filtered.rows.length).toBeGreaterThan(0);
  expect(filtered.rows.every((r) => r["status"] === "active")).toBe(true);
});

test("filter ne (HTTP): status!=draft excludes drafts", async () => {
  const res = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    "showcase:query:item:list",
    { limit: 200, filter: { field: "status", op: "ne", value: "draft" } },
    TestUsers.admin,
  );
  expect(res.rows.every((r) => r["status"] !== "draft")).toBe(true);
});

test("filter lt/gt (HTTP): priority Range-Compare", async () => {
  // Unique priority markers (200-204) so the tests within the suite do not
  // disturb other priority values.
  for (let i = 200; i <= 204; i++) {
    await stack.http.writeOk(
      "showcase:write:item:create",
      {
        title: `filter-prio-${i}`,
        status: "draft",
        isDone: false,
        priority: i,
        dueDate: "2026-05-01",
        notes: "",
      },
      TestUsers.admin,
    );
  }
  const lt = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    "showcase:query:item:list",
    { limit: 200, filter: { field: "priority", op: "lt", value: 202 } },
    TestUsers.admin,
  );
  // 200 + 201 sind drin, 202+ raus.
  const ltPriorities = lt.rows.map((r) => r["priority"]).filter((p) => typeof p === "number");
  expect(ltPriorities.every((p) => (p as number) < 202)).toBe(true);

  const gt = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    "showcase:query:item:list",
    { limit: 200, filter: { field: "priority", op: "gt", value: 202 } },
    TestUsers.admin,
  );
  const gtPriorities = gt.rows.map((r) => r["priority"]).filter((p) => typeof p === "number");
  expect(gtPriorities.every((p) => (p as number) > 202)).toBe(true);
});

test("filter in (HTTP): priority IN [...] inkl. empty-array → leeres Resultat", async () => {
  const res = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    "showcase:query:item:list",
    {
      limit: 200,
      filter: { field: "priority", op: "in", value: [200, 201, 204] },
    },
    TestUsers.admin,
  );
  const found = res.rows.map((r) => r["priority"]);
  expect(found.every((p) => p === 200 || p === 201 || p === 204)).toBe(true);

  // Empty-array IN: by convention "no match" — pins that the server
  // does not do "match-all" (which would be Drizzle's default behavior).
  const empty = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    "showcase:query:item:list",
    { limit: 200, filter: { field: "priority", op: "in", value: [] } },
    TestUsers.admin,
  );
  expect(empty.rows).toHaveLength(0);
});

test("filter undefined (HTTP): default path returns all items (no regression)", async () => {
  // Pins that callers without a filter get the previous path — no
  // hidden "match-none" default or schema drift in the Zod pipe.
  // Uses a freshly created test marker so a result exists even with an
  // isolated DB.
  await stack.http.writeOk(
    "showcase:write:item:create",
    {
      title: "no-filter-marker",
      status: "draft",
      isDone: false,
      priority: 999,
      dueDate: "2026-05-01",
      notes: "",
    },
    TestUsers.admin,
  );
  const all = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    "showcase:query:item:list",
    { limit: 200 },
    TestUsers.admin,
  );
  expect(all.rows.find((r) => r["title"] === "no-filter-marker")).toBeDefined();
});

test("actionForm (HTTP): submit with only title+priority creates item via item:create", async () => {
  // Pins Tier-2.7d end to end: itemQuickAddScreen sends only 2
  // fields (title + priority), while itemEntity has 6 fields in
  // total. Defaults in the insert schema (status="draft", isDone=false,
  // notes/dueDate optional) make the submit valid without the
  // actionForm rendering all fields. Verifies that payloadMode=
  // "values" + server-side defaults work together.
  const created = await stack.http.writeOk<{ id: string }>(
    "showcase:write:item:create",
    { title: "quick-via-action", priority: 7 },
    TestUsers.admin,
  );
  expect(created.id).toBeDefined();

  const list = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    "showcase:query:item:list",
    { limit: 200 },
    TestUsers.admin,
  );
  const found = list.rows.find((r) => r["id"] === created.id);
  expect(found).toBeDefined();
  expect(found?.["title"]).toBe("quick-via-action");
  expect(found?.["priority"]).toBe(7);
  expect(found?.["status"]).toBe("draft"); // Server-default greift
});

test("Reference field: parent + child, child stores parentId, list+detail return UUID", async () => {
  // Pins end to end that the `reference` field type:
  //   1) creates a UUID column in the DB (table-builder)
  //   2) accepts the UUID via the Zod validator (schema-builder)
  //   3) comes back as a UUID on read (the renderer does a bulk lookup
  //      against item:list for display resolution).
  const parent = await stack.http.writeOk<{ id: string }>(
    "showcase:write:item:create",
    {
      title: "ref-parent",
      status: "active",
      isDone: false,
      priority: 1,
      dueDate: "2026-05-01",
      notes: "",
    },
    TestUsers.admin,
  );
  const child = await stack.http.writeOk<{ id: string }>(
    "showcase:write:item:create",
    {
      title: "ref-child",
      status: "draft",
      isDone: false,
      priority: 2,
      dueDate: "2026-05-01",
      notes: "",
      parentId: parent.id,
    },
    TestUsers.admin,
  );
  expect(child.id).toBeDefined();

  const detail = await stack.http.queryOk<Record<string, unknown>>(
    "showcase:query:item:detail",
    { id: child.id },
    TestUsers.admin,
  );
  expect(detail["parentId"]).toBe(parent.id);
});

test("Remote combobox: list with search parameter passes through the pipeline without crashing", async () => {
  // Pins the HTTP pipeline for search: Zod validation, handler,
  // executor with ctx.services.searchAdapter passed through. Real filter
  // behavior is pinned in the executor unit integration test (event-store-
  // executor-list.integration.test.ts) — there with a mock adapter,
  // without the test stack having to register a search
  // EventConsumer.
  const result = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    "showcase:query:item:list",
    { limit: 50, search: "irgendwas" },
    TestUsers.admin,
  );
  expect(Array.isArray(result.rows)).toBe(true);
});

test("Server eager load: detail with reference field returns _refs.parentId with resolved row", async () => {
  // Pins that entity-handlers.detail runs an
  // enrichRowWithReferences stage after executor.detail and sends the referenced
  // parent row along as _refs.parentId.
  const parent = await stack.http.writeOk<{ id: string }>(
    "showcase:write:item:create",
    {
      title: "eagerload-parent",
      status: "active",
      isDone: false,
      priority: 1,
      dueDate: "2026-05-01",
      notes: "",
    },
    TestUsers.admin,
  );
  const child = await stack.http.writeOk<{ id: string }>(
    "showcase:write:item:create",
    {
      title: "eagerload-child",
      status: "draft",
      isDone: false,
      priority: 2,
      dueDate: "2026-05-01",
      notes: "",
      parentId: parent.id,
    },
    TestUsers.admin,
  );

  const detail = await stack.http.queryOk<{
    _refs?: { parentId?: { id: string; title: string } };
  }>("showcase:query:item:detail", { id: child.id }, TestUsers.admin);
  // _refs.parentId ist die resolved Parent-Row (komplettes Object)
  expect(detail._refs).toBeDefined();
  const parentRef = detail._refs?.parentId;
  expect(parentRef).toBeDefined();
  expect(parentRef?.id).toBe(parent.id);
  expect(parentRef?.title).toBe("eagerload-parent");
});

test("detail with multi-reference returns _refs.relatedIds as an array", async () => {
  // Symmetric to the list-multi test, but for detail. Multi-reference
  // in the detail path goes through enrichRowWithReferences.
  const tag1 = await stack.http.writeOk<{ id: string }>(
    "showcase:write:item:create",
    {
      title: "detail-multi-tag1",
      status: "active",
      isDone: false,
      priority: 1,
      dueDate: "2026-05-01",
      notes: "",
    },
    TestUsers.admin,
  );
  const tag2 = await stack.http.writeOk<{ id: string }>(
    "showcase:write:item:create",
    {
      title: "detail-multi-tag2",
      status: "active",
      isDone: false,
      priority: 1,
      dueDate: "2026-05-01",
      notes: "",
    },
    TestUsers.admin,
  );
  const main = await stack.http.writeOk<{ id: string }>(
    "showcase:write:item:create",
    {
      title: "detail-multi-main",
      status: "draft",
      isDone: false,
      priority: 1,
      dueDate: "2026-05-01",
      notes: "",
      relatedIds: [tag1.id, tag2.id],
    },
    TestUsers.admin,
  );

  const detail = await stack.http.queryOk<{
    _refs?: { relatedIds?: Array<{ id: string }> };
  }>("showcase:query:item:detail", { id: main.id }, TestUsers.admin);
  const relatedRefs = detail._refs?.relatedIds;
  expect(Array.isArray(relatedRefs)).toBe(true);
  const refIds = (relatedRefs ?? []).map((r) => r.id).sort();
  expect(refIds).toEqual([tag1.id, tag2.id].sort());
});

test("list with single-reference returns _refs.parentId resolved object", async () => {
  // Symmetric to the detail-single test, but for list. Single
  // reference in the list path goes through enrichWithReferences.
  const parent = await stack.http.writeOk<{ id: string }>(
    "showcase:write:item:create",
    {
      title: "list-single-parent",
      status: "active",
      isDone: false,
      priority: 1,
      dueDate: "2026-05-01",
      notes: "",
    },
    TestUsers.admin,
  );
  const child = await stack.http.writeOk<{ id: string }>(
    "showcase:write:item:create",
    {
      title: "list-single-child",
      status: "draft",
      isDone: false,
      priority: 1,
      dueDate: "2026-05-01",
      notes: "",
      parentId: parent.id,
    },
    TestUsers.admin,
  );

  type ItemRow = {
    id: string;
    _refs?: { parentId?: { id: string; title: string } };
  };
  const list = await stack.http.queryOk<{ rows: ItemRow[] }>(
    "showcase:query:item:list",
    { limit: 200 },
    TestUsers.admin,
  );
  const found = list.rows.find((r) => r.id === child.id);
  expect(found).toBeDefined();
  const parentRef = found?._refs?.parentId;
  expect(parentRef).toBeDefined();
  expect(parentRef?.id).toBe(parent.id);
  expect(parentRef?.title).toBe("list-single-parent");
});

test("Server eager load: list returns _refs for relatedIds (multi-reference)", async () => {
  // Pinst Multi-Reference-Eagerload: list-row hat _refs.relatedIds
  // als Array der resolved rows (nicht nur UUIDs).
  const a = await stack.http.writeOk<{ id: string }>(
    "showcase:write:item:create",
    {
      title: "eager-multi-a",
      status: "active",
      isDone: false,
      priority: 1,
      dueDate: "2026-05-01",
      notes: "",
    },
    TestUsers.admin,
  );
  const b = await stack.http.writeOk<{ id: string }>(
    "showcase:write:item:create",
    {
      title: "eager-multi-b",
      status: "active",
      isDone: false,
      priority: 1,
      dueDate: "2026-05-01",
      notes: "",
    },
    TestUsers.admin,
  );
  const main = await stack.http.writeOk<{ id: string }>(
    "showcase:write:item:create",
    {
      title: "eager-multi-main",
      status: "draft",
      isDone: false,
      priority: 1,
      dueDate: "2026-05-01",
      notes: "",
      relatedIds: [a.id, b.id],
    },
    TestUsers.admin,
  );

  const list = await stack.http.queryOk<{
    rows: Array<Record<string, unknown> & { _refs?: Record<string, unknown> }>;
  }>("showcase:query:item:list", { limit: 200 }, TestUsers.admin);
  const found = list.rows.find((r) => r["id"] === main.id);
  expect(found).toBeDefined();
  const relatedRefs = found?._refs?.["relatedIds"] as Array<Record<string, unknown>> | undefined;
  expect(Array.isArray(relatedRefs)).toBe(true);
  // Both a and b are in the _refs array (order is not
  // guaranteed because DB WHERE-IN is not ordering-stable).
  const refIds = (relatedRefs ?? []).map((r) => r["id"]).sort();
  expect(refIds).toEqual([a.id, b.id].sort());
});

test("Multi-reference (relatedIds): Array of UUIDs round-trips through HTTP/Zod/DB", async () => {
  // Pins that `multiple: true` on reference:
  //   1) stores a jsonb array<string> in the DB
  //   2) accepts z.array(z.uuid()) in the insert schema
  //   3) the read side returns the array
  const a = await stack.http.writeOk<{ id: string }>(
    "showcase:write:item:create",
    {
      title: "multi-related-a",
      status: "active",
      isDone: false,
      priority: 1,
      dueDate: "2026-05-01",
      notes: "",
    },
    TestUsers.admin,
  );
  const b = await stack.http.writeOk<{ id: string }>(
    "showcase:write:item:create",
    {
      title: "multi-related-b",
      status: "active",
      isDone: false,
      priority: 1,
      dueDate: "2026-05-01",
      notes: "",
    },
    TestUsers.admin,
  );
  const main = await stack.http.writeOk<{ id: string }>(
    "showcase:write:item:create",
    {
      title: "multi-main",
      status: "draft",
      isDone: false,
      priority: 1,
      dueDate: "2026-05-01",
      notes: "",
      relatedIds: [a.id, b.id],
    },
    TestUsers.admin,
  );

  const detail = await stack.http.queryOk<Record<string, unknown>>(
    "showcase:query:item:detail",
    { id: main.id },
    TestUsers.admin,
  );
  expect(Array.isArray(detail["relatedIds"])).toBe(true);
  expect((detail["relatedIds"] as string[]).sort()).toEqual([a.id, b.id].sort());
});

test("item:delete via rowAction-Pfad: Default-Payload {id} reicht", async () => {
  // Pins Tier-2.7a end to end: the delete action in itemListScreen
  // sends only `{ id: row.id }` (no explicit payload builder in the
  // schema), and the server-side write handler accepts that. Without
  // this test a schema drift (e.g. the delete handler expecting a
  // version field) would only show up on the first browser click.
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
  // The default payload is exactly `{ id: row.id }` — pins the convention
  // that the delete handler does not require an additional version field.
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

// Pinst dass items via dispatch erstellbar sind, mit den Payload-Shapes
// die der Showcase-Seed nutzt — title/status/isDone/priority/dueDate/
// notes. Hat einen 500-Crash mit "Cannot parse: 2026-04-10" gefangen
// (type:"date" Schema-Drift zwischen Zod-Validator [YYYY-MM-DD] und
// dialect.toDriver [Temporal.Instant.from braucht ISO-datetime]). Der
// Test rennt jetzt beim CI mit, damit die Regression nicht wiederkommt.

import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEntityTable,
  setupTestStack,
  type TestStack,
  TestUsers,
} from "@cosmicdrift/kumiko-framework/stack";
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

// Tier-2.7c End-to-End: dispatcher payload mit `filter` durchläuft
// Zod-Validator + executor.list WHERE-Builder. Tests pinnen alle 5 Ops
// über den vollen HTTP-Pfad — pre-2.7c hätte Zod den filter rejected
// und der Server hätte status:400 statt gefilterter Liste geantwortet.
//
// Die Tests legen pro Test eigene Items mit eindeutigen Markern an
// (priority-Werte 100-104) damit sie unabhängig von anderen Tests in
// derselben Suite stabil sind. status="active"/"draft" reicht für eq/ne,
// priority für lt/gt/in.
test("filter eq (HTTP): status=active liefert nur active items", async () => {
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

test("filter ne (HTTP): status!=draft schließt drafts aus", async () => {
  const res = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    "showcase:query:item:list",
    { limit: 200, filter: { field: "status", op: "ne", value: "draft" } },
    TestUsers.admin,
  );
  expect(res.rows.every((r) => r["status"] !== "draft")).toBe(true);
});

test("filter lt/gt (HTTP): priority Range-Compare", async () => {
  // Eindeutige priority-Marker (200-204) damit die Suite-internen Tests
  // andere priority-Werte nicht stören.
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

  // Empty-array IN: per Convention "no match" — pinst dass der Server
  // nicht "match-all" macht (was Drizzle's Default-Verhalten wäre).
  const empty = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    "showcase:query:item:list",
    { limit: 200, filter: { field: "priority", op: "in", value: [] } },
    TestUsers.admin,
  );
  expect(empty.rows).toHaveLength(0);
});

test("filter undefined (HTTP): default-Pfad, alle Items zurück (keine Regression)", async () => {
  // Pinst dass Caller ohne filter den vorherigen Pfad bekommt — kein
  // versteckter "match-none"-Default oder Schema-Drift in der Zod-Pipe.
  // Nutzt einen frisch angelegten Test-Marker damit auch bei isolierter
  // DB ein Resultat existiert.
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
    { limit: 500 },
    TestUsers.admin,
  );
  expect(all.rows.find((r) => r["title"] === "no-filter-marker")).toBeDefined();
});

test("actionForm Tier 2.7d (HTTP): submit mit nur title+priority erstellt item via item:create", async () => {
  // Pinst Tier-2.7d End-to-End: itemQuickAddScreen schickt nur 2
  // Felder (title + priority), während itemEntity insgesamt 6 Felder
  // hat. Defaults im Insert-Schema (status="draft", isDone=false,
  // notes/dueDate optional) machen den Submit valide ohne dass die
  // actionForm alle Felder rendert. Verifiziert dass payloadMode=
  // "values" + Server-side Defaults zusammen funktionieren.
  const created = await stack.http.writeOk<{ id: string }>(
    "showcase:write:item:create",
    { title: "quick-via-action", priority: 7 },
    TestUsers.admin,
  );
  expect(created.id).toBeDefined();

  const list = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    "showcase:query:item:list",
    { limit: 500 },
    TestUsers.admin,
  );
  const found = list.rows.find((r) => r["id"] === created.id);
  expect(found).toBeDefined();
  expect(found?.["title"]).toBe("quick-via-action");
  expect(found?.["priority"]).toBe(7);
  expect(found?.["status"]).toBe("draft"); // Server-default greift
});

test("Tier 2.7e-3 Reference-Field: parent + child, child speichert parentId, list+detail liefern UUID zurück", async () => {
  // Pinst End-to-End dass das `reference`-Field-Type:
  //   1) eine UUID-Spalte in der DB anlegt (table-builder)
  //   2) die UUID via Zod-Validator akzeptiert (schema-builder)
  //   3) auf Read als UUID zurückkommt (Renderer macht Bulk-Lookup
  //      gegen item:list für die Display-Auflösung).
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

test("Tier 2.7e Remote-Combobox: list mit search-Param geht durch die Pipeline ohne Crash", async () => {
  // Pinst die HTTP-Pipeline für search: Zod-Validation, Handler,
  // executor mit ctx.searchAdapter durchgereicht. Echtes Filter-
  // Verhalten ist im executor-Unit-Integrationstest (event-store-
  // executor-list.integration.ts) gepinst — dort mit Mock-Adapter,
  // ohne dass der test-stack einen Search-EventConsumer registriert
  // haben muss.
  const result = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    "showcase:query:item:list",
    { limit: 50, search: "irgendwas" },
    TestUsers.admin,
  );
  expect(Array.isArray(result.rows)).toBe(true);
});

test("Tier 2.7e Server-Eagerload: detail mit reference-Feld liefert _refs.parentId mit resolved Row", async () => {
  // Pinst dass entity-handlers.detail nach executor.detail eine
  // enrichRowWithReferences-Stage durchläuft und die referenced
  // parent-Row als _refs.parentId mitschickt.
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

test("Tier 2.7e Audit-Fix #8: detail mit multi-reference liefert _refs.relatedIds als Array", async () => {
  // Symmetrisch zum list-multi-Test, aber für detail. Multi-Reference
  // im detail-Pfad geht durch enrichRowWithReferences.
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

test("Tier 2.7e Audit-Fix #8: list mit single-reference liefert _refs.parentId resolved Object", async () => {
  // Symmetrisch zum detail-single-Test, aber für list. Single-
  // Reference im list-Pfad geht durch enrichWithReferences.
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
    { limit: 500 },
    TestUsers.admin,
  );
  const found = list.rows.find((r) => r.id === child.id);
  expect(found).toBeDefined();
  const parentRef = found?._refs?.parentId;
  expect(parentRef).toBeDefined();
  expect(parentRef?.id).toBe(parent.id);
  expect(parentRef?.title).toBe("list-single-parent");
});

test("Tier 2.7e Server-Eagerload: list liefert _refs für relatedIds (multi-reference)", async () => {
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
  }>("showcase:query:item:list", { limit: 500 }, TestUsers.admin);
  const found = list.rows.find((r) => r["id"] === main.id);
  expect(found).toBeDefined();
  const relatedRefs = found?._refs?.["relatedIds"] as Array<Record<string, unknown>> | undefined;
  expect(Array.isArray(relatedRefs)).toBe(true);
  // Beide a und b sind im _refs-Array (Reihenfolge ist nicht
  // garantiert weil DB-WHERE-IN nicht ordering-stable ist).
  const refIds = (relatedRefs ?? []).map((r) => r["id"]).sort();
  expect(refIds).toEqual([a.id, b.id].sort());
});

test("Tier 2.7e-Multi: Multi-Reference (relatedIds) — Array von UUIDs round-trips durch HTTP/Zod/DB", async () => {
  // Pinst dass `multiple: true` auf reference:
  //   1) jsonb-Array<string> in der DB speichert
  //   2) z.array(z.uuid()) im Insert-Schema akzeptiert
  //   3) der Read-Side das Array zurückliefert
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

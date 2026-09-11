// #2765 — named domain events (r.defineEvent, not created/updated/restored/
// deleted/forgotten) on an entity with searchable fields must still reach
// the search index. The event payload only carries the named event's own
// field slice, so the consumer reads the live projection row instead.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import { asRawClient, buildEntityTable, createEventStoreExecutor, createTenantDb } from "../../db";
import { createEntity, createTextField, defineFeature } from "../../engine";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack";
import { SEARCH_CONSUMER_NAME } from "../system-hooks";

const noteEntity = createEntity({
  table: "read_named_search_notes",
  fields: {
    label: createTextField({ required: true, maxLength: 100, searchable: true }),
  },
  softDelete: true,
});
const noteTable = buildEntityTable("note", noteEntity);

// No DDL table for this one — proves the searchable-fields gate runs
// before any query, not after a failed one.
const ghostEntity = createEntity({
  table: "read_named_search_ghosts",
  fields: {
    note: createTextField({ required: true, maxLength: 50 }),
  },
});

const ROW_LABEL = "row-projection-value";

const namedSearchFeature = defineFeature("named-search", (r) => {
  r.entity("note", noteEntity);
  r.entity("ghost", ghostEntity);

  const relabeled = r.defineEvent("relabeled", z.object({ label: z.string() }), {
    piiFields: "none",
  });
  const poked = r.defineEvent("poked", z.object({}), { piiFields: "none" });

  r.writeHandler(
    "note:relabel",
    z.object({ id: z.uuid(), label: z.string() }),
    async (event, ctx) => {
      await ctx.unsafeAppendEvent({
        aggregateId: event.payload.id,
        aggregateType: "note",
        type: relabeled.name,
        payload: { label: event.payload.label },
      });
      // Bypasses the executor on purpose (raw SQL, not updateMany — the
      // executor-built table is write-locked to the executor) so the row
      // ends up with a value distinct from the event payload above. Proves
      // the search consumer reads the row, not the payload.
      await asRawClient(ctx.db).unsafe(
        `UPDATE read_named_search_notes SET label = $1 WHERE id = $2`,
        [ROW_LABEL, event.payload.id],
      );
      return { isSuccess: true as const, data: { id: event.payload.id } };
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "ghost:poke",
    z.object({ id: z.uuid() }),
    async (event, ctx) => {
      await ctx.unsafeAppendEvent({
        aggregateId: event.payload.id,
        aggregateType: "ghost",
        type: poked.name,
        payload: {},
      });
      return { isSuccess: true as const, data: { id: event.payload.id } };
    },
    { access: { roles: ["Admin"] } },
  );
});

let stack: TestStack;
const admin = TestUsers.admin;

function noteExecutor() {
  return createEventStoreExecutor(noteTable, noteEntity, {
    entityName: "note",
    searchAdapter: stack.search,
  });
}

function tenantDb() {
  return createTenantDb(stack.db, admin.tenantId, "system");
}

beforeAll(async () => {
  stack = await setupTestStack({ features: [namedSearchFeature] });
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack, ["read_named_search_notes"]);
});

describe("search consumer: named domain events (#2765)", () => {
  test("named event on a searchable entity indexes from the projection row, not the payload", async () => {
    const created = await noteExecutor().create({ label: "original-label" }, admin, tenantDb());
    if (!created.isSuccess) throw new Error("create failed");
    const id = String(created.data.id);
    await stack.eventDispatcher?.runOnce();

    const beforeHits = await stack.search.search(admin.tenantId, "original-label", {
      filterType: "note",
    });
    expect(beforeHits.some((h) => String(h.entityId) === id)).toBe(true);

    await stack.http.writeOk(
      "named-search:write:note:relabel",
      { id, label: "payload-label-should-not-be-indexed" },
      admin,
    );
    await stack.eventDispatcher?.runOnce();

    const payloadHits = await stack.search.search(
      admin.tenantId,
      "payload-label-should-not-be-indexed",
      { filterType: "note" },
    );
    expect(payloadHits).toHaveLength(0);

    const rowHits = await stack.search.search(admin.tenantId, ROW_LABEL, { filterType: "note" });
    expect(rowHits.some((h) => String(h.entityId) === id)).toBe(true);
  });

  test("named event on an entity without searchable fields triggers no query and no index", async () => {
    const id = crypto.randomUUID();
    // Ghost has no DDL table — if the consumer queried it anyway, runOnce()
    // would reject instead of completing (relation does not exist).
    await stack.http.writeOk("named-search:write:ghost:poke", { id }, admin);
    const result = await stack.eventDispatcher?.runOnce();
    expect(result?.byConsumer[SEARCH_CONSUMER_NAME]?.failed).toBe(0);

    const hits = await stack.search.search(admin.tenantId, "poked", { filterType: "ghost" });
    expect(hits).toHaveLength(0);
  });

  test("named event with no live projection row removes the index entry", async () => {
    const created = await noteExecutor().create({ label: "vanishing-label" }, admin, tenantDb());
    if (!created.isSuccess) throw new Error("create failed");
    const id = String(created.data.id);
    await stack.eventDispatcher?.runOnce();
    expect(
      (await stack.search.search(admin.tenantId, "vanishing-label", { filterType: "note" })).some(
        (h) => String(h.entityId) === id,
      ),
    ).toBe(true);

    // Hard-delete the row directly, bypassing executor.forget — simulates a
    // projection row that's simply gone, distinct from the deleted/forgotten
    // verb path covered by the regression test below.
    await asRawClient(stack.db).unsafe(`DELETE FROM read_named_search_notes WHERE id = $1`, [id]);

    await stack.http.writeOk("named-search:write:note:relabel", { id, label: "irrelevant" }, admin);
    await stack.eventDispatcher?.runOnce();

    const after = await stack.search.search(admin.tenantId, "vanishing-label", {
      filterType: "note",
    });
    expect(after.some((h) => String(h.entityId) === id)).toBe(false);
  });

  test("named event on a soft-deleted entity does not resurrect the index entry", async () => {
    const created = await noteExecutor().create({ label: "soft-deleted-label" }, admin, tenantDb());
    if (!created.isSuccess) throw new Error("create failed");
    const id = created.data.id;
    await stack.eventDispatcher?.runOnce();
    expect(
      (
        await stack.search.search(admin.tenantId, "soft-deleted-label", { filterType: "note" })
      ).some((h) => String(h.entityId) === String(id)),
    ).toBe(true);

    const deleted = await noteExecutor().delete({ id }, admin, tenantDb());
    if (!deleted.isSuccess) throw new Error("delete failed");
    await stack.eventDispatcher?.runOnce();

    // The row still physically exists (isDeleted: true) — a plain fetchOne
    // without the soft-delete filter would find it and re-index it.
    await stack.http.writeOk(
      "named-search:write:note:relabel",
      { id: String(id), label: "irrelevant" },
      admin,
    );
    await stack.eventDispatcher?.runOnce();

    const after = await stack.search.search(admin.tenantId, ROW_LABEL, { filterType: "note" });
    expect(after.some((h) => String(h.entityId) === String(id))).toBe(false);
  });

  test("created/updated/restored/deleted/forgotten still index/remove as before (regression)", async () => {
    const created = await noteExecutor().create({ label: "crud-created" }, admin, tenantDb());
    if (!created.isSuccess) throw new Error("create failed");
    const id = created.data.id;
    await stack.eventDispatcher?.runOnce();
    expect(
      (await stack.search.search(admin.tenantId, "crud-created", { filterType: "note" })).some(
        (h) => String(h.entityId) === String(id),
      ),
    ).toBe(true);

    const updated = await noteExecutor().update(
      { id, changes: { label: "crud-updated" } },
      admin,
      tenantDb(),
      { skipOptimisticLock: true },
    );
    if (!updated.isSuccess) throw new Error("update failed");
    await stack.eventDispatcher?.runOnce();
    expect(
      (await stack.search.search(admin.tenantId, "crud-updated", { filterType: "note" })).some(
        (h) => String(h.entityId) === String(id),
      ),
    ).toBe(true);

    const deleted = await noteExecutor().delete({ id }, admin, tenantDb());
    if (!deleted.isSuccess) throw new Error("delete failed");
    await stack.eventDispatcher?.runOnce();
    expect(
      (await stack.search.search(admin.tenantId, "crud-updated", { filterType: "note" })).some(
        (h) => String(h.entityId) === String(id),
      ),
    ).toBe(false);

    const restored = await noteExecutor().restore({ id }, admin, tenantDb());
    if (!restored.isSuccess) throw new Error("restore failed");
    await stack.eventDispatcher?.runOnce();
    expect(
      (await stack.search.search(admin.tenantId, "crud-updated", { filterType: "note" })).some(
        (h) => String(h.entityId) === String(id),
      ),
    ).toBe(true);

    const forgotten = await noteExecutor().forget({ id }, admin, tenantDb());
    if (!forgotten.isSuccess) throw new Error("forget failed");
    await stack.eventDispatcher?.runOnce();
    expect(
      (await stack.search.search(admin.tenantId, "crud-updated", { filterType: "note" })).some(
        (h) => String(h.entityId) === String(id),
      ),
    ).toBe(false);
  });
});

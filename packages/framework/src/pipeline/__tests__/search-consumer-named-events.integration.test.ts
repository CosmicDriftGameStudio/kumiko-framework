// #2765 — named domain events (r.defineEvent, not created/updated/restored/
// deleted/forgotten) on an entity with searchable fields must still reach
// the search index. The event payload only carries the named event's own
// field slice, so the consumer reads the live projection row instead.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
import * as z from "zod";
import { configurePiiSubjectKms, InMemoryKmsAdapter, isPiiCiphertext } from "../../crypto/index.js";
import {
  asRawClient,
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
} from "../../db/index.js";
import { createEntity, createTextField, defineFeature } from "../../engine/index.js";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack/index.js";
import { SEARCH_CONSUMER_NAME } from "../system-hooks.js";

const noteEntity = createEntity({
  table: "read_named_search_notes",
  fields: {
    label: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      maxLength: 100,
      searchable: true,
    }),
  },
  softDelete: true,
});
const noteTable = buildEntityTable("note", noteEntity);

// personal: "self" + find: "fuzzy" → searchable, but the read row holds ciphertext.
const secretEntity = createEntity({
  table: "read_named_search_secrets",
  fields: {
    label: createTextField({ required: true, maxLength: 100, personal: "self", find: "fuzzy" }),
  },
});
const secretTable = buildEntityTable("secret", secretEntity);

// No DDL table for this one — proves the searchable-fields gate runs
// before any query, not after a failed one.
const ghostEntity = createEntity({
  table: "read_named_search_ghosts",
  fields: {
    note: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      maxLength: 50,
    }),
  },
});

// No searchable stem field at all — only a searchPayloadExtension feeds the
// index (the customFields-only case). The extension indexes the row's `marker`.
const extOnlyEntity = createEntity({
  table: "read_named_search_ext_only",
  fields: {
    marker: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      maxLength: 100,
    }),
  },
});
const extOnlyTable = buildEntityTable("ext-only", extOnlyEntity);
const EXT_ROW_MARKER = "ext-row-projection-marker";

// Holds a sensitive column; a generic extension that echoes the state's keys must never see it.
const vaultEntity = createEntity({
  table: "read_named_search_vaults",
  fields: {
    title: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      maxLength: 100,
    }),
    apiToken: createTextField({
      personal: "self",
      find: "secret",
      sensitive: true,
      required: true,
      maxLength: 100,
    }),
  },
});
const vaultTable = buildEntityTable("vault", vaultEntity);

const ROW_LABEL = "row-projection-value";

const namedSearchFeature = defineFeature("named-search", (r) => {
  r.entity("note", noteEntity);
  r.entity("ghost", ghostEntity);
  r.entity("secret", secretEntity);
  const extOnly = r.entity("ext-only", extOnlyEntity);
  r.searchPayloadExtension(extOnly, ({ state }) => ({ extIndexed: state["marker"] }));

  const relabeled = r.defineEvent("relabeled", z.object({ label: z.string() }), {
    piiFields: "none",
  });
  const vault = r.entity("vault", vaultEntity);
  r.searchPayloadExtension(vault, ({ state }) => ({ stateKeys: Object.keys(state).join(" ") }));

  const poked = r.defineEvent("poked", z.object({}), { piiFields: "none" });

  r.writeHandler(
    "vault:poke",
    z.object({ id: z.uuid() }),
    async (event, ctx) => {
      await ctx.unsafeAppendEvent({
        aggregateId: event.payload.id,
        aggregateType: "vault",
        type: poked.name,
        payload: {},
      });
      return { isSuccess: true as const, data: { id: event.payload.id } };
    },
    { access: { roles: ["Admin"] } },
  );

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
      await asRawClient(ctx.db.unsafeRaw("test: raw row update bypassing the executor")).unsafe(
        `UPDATE read_named_search_notes SET label = $1 WHERE id = $2`,
        [ROW_LABEL, event.payload.id],
      );
      return { isSuccess: true as const, data: { id: event.payload.id } };
    },
    {
      access: { roles: ["Admin"] },
      escapeHatch: { reason: "test: raw row update bypassing the executor" },
    },
  );

  r.writeHandler(
    "ext-only:poke",
    z.object({ id: z.uuid() }),
    async (event, ctx) => {
      await ctx.unsafeAppendEvent({
        aggregateId: event.payload.id,
        aggregateType: "ext-only",
        type: poked.name,
        payload: {},
      });
      // Raw update (not the executor) so only the named-event path can see this value.
      await asRawClient(ctx.db.unsafeRaw("test: raw row update bypassing the executor")).unsafe(
        `UPDATE read_named_search_ext_only SET marker = $1 WHERE id = $2`,
        [EXT_ROW_MARKER, event.payload.id],
      );
      return { isSuccess: true as const, data: { id: event.payload.id } };
    },
    {
      access: { roles: ["Admin"] },
      escapeHatch: { reason: "test: raw row update bypassing the executor" },
    },
  );

  r.writeHandler(
    "secret:poke",
    z.object({ id: z.uuid() }),
    async (event, ctx) => {
      await ctx.unsafeAppendEvent({
        aggregateId: event.payload.id,
        aggregateType: "secret",
        type: poked.name,
        payload: {},
      });
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
  // The in-memory adapter only searches configured fields; the extension's
  // `extIndexed` key is not a stem field, so it has to be listed explicitly.
  stack = await setupTestStack({
    features: [namedSearchFeature],
    searchConfig: {
      tenantId: admin.tenantId,
      searchableFields: ["label", "extIndexed", "stateKeys"],
      rankingFields: ["label", "extIndexed", "stateKeys"],
    },
  });
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
  await unsafeCreateEntityTable(stack.db, secretEntity, "secret");
  await unsafeCreateEntityTable(stack.db, extOnlyEntity, "ext-only");
  await unsafeCreateEntityTable(stack.db, vaultEntity, "vault");
});

beforeEach(() => {
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  resetPiiSubjectKmsForTests();
  await resetEventStore(stack, [
    "read_named_search_notes",
    "read_named_search_secrets",
    "read_named_search_ext_only",
    "read_named_search_vaults",
  ]);
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

  test("named event on a subject-encrypted searchable field indexes the decrypted value, never ciphertext", async () => {
    const plain = "NamedEventSecretLabel";
    const created = await createEventStoreExecutor(secretTable, secretEntity, {
      entityName: "secret",
    }).create({ label: plain }, admin, tenantDb());
    if (!created.isSuccess) throw new Error("create failed");
    const id = String(created.data.id);

    const rows = await asRawClient(stack.db).unsafe<{ label: unknown }>(
      `SELECT label FROM read_named_search_secrets WHERE id = $1`,
      [id],
    );
    expect(isPiiCiphertext(rows[0]?.label)).toBe(true);

    await stack.http.writeOk("named-search:write:secret:poke", { id }, admin);
    await stack.eventDispatcher?.runOnce();

    const hits = await stack.search.search(admin.tenantId, plain, { filterType: "secret" });
    expect(hits.some((h) => String(h.entityId) === id)).toBe(true);
  });

  test("named event on an extension-only entity (no searchable stem fields) indexes the extension field from the row", async () => {
    const created = await createEventStoreExecutor(extOnlyTable, extOnlyEntity, {
      entityName: "ext-only",
    }).create({ marker: "ext-created-marker" }, admin, tenantDb());
    if (!created.isSuccess) throw new Error("create failed");
    const id = String(created.data.id);
    await stack.eventDispatcher?.runOnce();

    await stack.http.writeOk("named-search:write:ext-only:poke", { id }, admin);
    await stack.eventDispatcher?.runOnce();

    const hits = await stack.search.search(admin.tenantId, EXT_ROW_MARKER, {
      filterType: "ext-only",
    });
    expect(hits.some((h) => String(h.entityId) === id)).toBe(true);
  });

  test("named event never hands sensitive row fields to a search payload extension", async () => {
    const created = await createEventStoreExecutor(vaultTable, vaultEntity, {
      entityName: "vault",
    }).create({ title: "vault-title", apiToken: "tok-123" }, admin, tenantDb());
    if (!created.isSuccess) throw new Error("create failed");
    const id = String(created.data.id);

    await stack.http.writeOk("named-search:write:vault:poke", { id }, admin);
    await stack.eventDispatcher?.runOnce();

    const titleKeyHits = await stack.search.search(admin.tenantId, "title", {
      filterType: "vault",
    });
    expect(titleKeyHits.some((h) => String(h.entityId) === id)).toBe(true);
    const sensitiveKeyHits = await stack.search.search(admin.tenantId, "apiToken", {
      filterType: "vault",
    });
    expect(sensitiveKeyHits).toHaveLength(0);
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

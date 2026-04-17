// C2 — archiveStream (Marten-aligned).
//
// Marten's session.Events.ArchiveStream(id): the stream becomes read-only,
// loads return an empty slice, further appends throw. Restoring un-archives.
// Kumiko carries this as a sparse kumiko_archived_streams table so active
// streams never pay for extra metadata writes.

import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { buildDrizzleTable } from "../../db/table-builder";
import { createEntity, createTextField, defineFeature } from "../../engine";
import {
  ArchivedStreamError,
  isStreamArchived,
  loadAggregate as loadAggregateRaw,
} from "../../event-store";
import { createEntityTable, setupTestStack, type TestStack, TestUsers } from "../../testing";

const itemEntity = createEntity({
  table: "arch_items",
  idType: "uuid",
  fields: { label: createTextField({ required: true }) },
});
const itemTable = buildDrizzleTable("archItem", itemEntity);

const archFeature = defineFeature("archtest", (r) => {
  r.entity("archItem", itemEntity);

  const labelChanged = r.defineEvent("label-changed", z.object({ label: z.string() }));

  const executor = createEventStoreExecutor(itemTable, itemEntity, {
    entityName: "archItem",
  });

  r.writeHandler(
    "item:create",
    z.object({ label: z.string() }),
    async (event, ctx) => executor.create(event.payload, event.user, ctx.db),
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "item:relabel",
    z.object({ id: z.uuid(), label: z.string() }),
    async (event, ctx) => {
      await ctx.appendEvent({
        aggregateId: event.payload.id,
        aggregateType: "archItem",
        type: labelChanged.name,
        payload: { label: event.payload.label },
      });
      return { isSuccess: true as const, data: { id: event.payload.id } };
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "item:archive",
    z.object({ id: z.uuid(), reason: z.string().optional() }),
    async (event, ctx) => {
      await ctx.archiveStream(event.payload.id, {
        aggregateType: "archItem",
        ...(event.payload.reason !== undefined ? { reason: event.payload.reason } : {}),
      });
      return { isSuccess: true as const, data: { id: event.payload.id } };
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "item:restore",
    z.object({ id: z.uuid() }),
    async (event, ctx) => {
      await ctx.restoreStream(event.payload.id);
      return { isSuccess: true as const, data: { id: event.payload.id } };
    },
    { access: { roles: ["Admin"] } },
  );

  r.queryHandler(
    "item:events",
    z.object({ id: z.uuid() }),
    async (query, ctx) => ctx.loadAggregate(query.payload.id),
    { access: { openToAll: true } },
  );

  r.queryHandler(
    "item:is-archived",
    z.object({ id: z.uuid() }),
    async (query, ctx) => ctx.isStreamArchived(query.payload.id),
    { access: { openToAll: true } },
  );
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [archFeature], systemHooks: [] });
  await createEntityTable(stack.db.db, itemEntity, "archItem");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await stack.db.db.execute(
    sql`TRUNCATE events, arch_items, kumiko_archived_streams RESTART IDENTITY CASCADE`,
  );
});

describe("archiveStream — Marten ArchiveStream equivalent", () => {
  test("archived stream returns empty from ctx.loadAggregate", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      "archtest:write:item:create",
      { label: "alpha" },
      admin,
    );
    await stack.http.writeOk("archtest:write:item:relabel", { id, label: "beta" }, admin);

    // Pre-archive: two events visible.
    const before = await stack.http.queryOk<unknown[]>("archtest:query:item:events", { id }, admin);
    expect(before.length).toBe(2);

    await stack.http.writeOk("archtest:write:item:archive", { id, reason: "cleanup" }, admin);

    // Post-archive: empty slice by default.
    const after = await stack.http.queryOk<unknown[]>("archtest:query:item:events", { id }, admin);
    expect(after).toEqual([]);

    // Archive flag is visible.
    const archived = await stack.http.queryOk<boolean>(
      "archtest:query:item:is-archived",
      { id },
      admin,
    );
    expect(archived).toBe(true);

    // Low-level loader with includeArchived surfaces the events for ops.
    const raw = await loadAggregateRaw(stack.db.db, id, admin.tenantId, {
      includeArchived: true,
    });
    expect(raw).toHaveLength(2);
  });

  test("appendEvent on an archived stream is rejected with ArchivedStreamError", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      "archtest:write:item:create",
      { label: "before-archive" },
      admin,
    );
    await stack.http.writeOk("archtest:write:item:archive", { id }, admin);

    // Writing through the handler surfaces the ArchivedStreamError as a
    // 500 (InternalError path) — the framework treats archive violations
    // as logic errors, not user-input errors. The detail message is
    // masked in the HTTP response (don't leak internals), so the proof
    // is structural: 500 status + no event landed on disk.
    const res = await stack.http.write(
      "archtest:write:item:relabel",
      { id, label: "too-late" },
      admin,
    );
    expect(res.status).toBe(500);

    // Sanity: the failed write did not land on disk.
    const raw = await loadAggregateRaw(stack.db.db, id, admin.tenantId, {
      includeArchived: true,
    });
    const types = raw.map((e) => e.type);
    expect(types).toContain("archItem.created");
    expect(types).not.toContain("archtest:event:label-changed");
  });

  test("restoreStream reopens the stream for writes and reads", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      "archtest:write:item:create",
      { label: "phoenix" },
      admin,
    );
    await stack.http.writeOk("archtest:write:item:archive", { id }, admin);
    expect(await isStreamArchived(stack.db.db, admin.tenantId, id)).toBe(true);

    await stack.http.writeOk("archtest:write:item:restore", { id }, admin);
    expect(await isStreamArchived(stack.db.db, admin.tenantId, id)).toBe(false);

    // Writes go through again AND keep the correct version lineage —
    // the original "created" event is at version 1, so the post-restore
    // relabel lands at version 2.
    await stack.http.writeOk("archtest:write:item:relabel", { id, label: "reborn" }, admin);
    const events = await loadAggregateRaw(stack.db.db, id, admin.tenantId);
    expect(events.map((e) => e.version)).toEqual([1, 2]);
  });

  test("archive is idempotent — repeated archive calls do not throw", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      "archtest:write:item:create",
      { label: "repeat" },
      admin,
    );

    await stack.http.writeOk("archtest:write:item:archive", { id, reason: "first" }, admin);
    await stack.http.writeOk("archtest:write:item:archive", { id, reason: "second" }, admin);

    const archived = await isStreamArchived(stack.db.db, admin.tenantId, id);
    expect(archived).toBe(true);
  });

  test("ArchivedStreamError carries aggregateId + tenantId", () => {
    const err = new ArchivedStreamError(admin.tenantId, "agg-1");
    expect(err.aggregateId).toBe("agg-1");
    expect(err.tenantId).toBe(admin.tenantId);
    expect(err.name).toBe("ArchivedStreamError");
  });
});

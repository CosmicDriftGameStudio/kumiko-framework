import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor.js";
import { selectMany } from "../../db/query.js";
import { buildEntityTable } from "../../db/table-builder.js";
import {
  createEntity,
  createTextField,
  defineFeature,
  defineWriteHandler,
  type TenantId,
} from "../../engine/index.js";
import { FrameworkReasons } from "../../errors/index.js";
import { eventsTable } from "../../event-store/index.js";
import {
  createTestUser,
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "../../stack/index.js";

const noteEntity = createEntity({
  table: "read_fortenant_notes",
  fields: { label: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});
const noteTable = buildEntityTable("note", noteEntity);
const noteExecutor = createEventStoreExecutor(noteTable, noteEntity, { entityName: "note" });

const ownTenantId = testTenantId(1);
const foreignTenantId = testTenantId(2);
const systemAdmin = TestUsers.systemAdmin;
const tenantAdmin = createTestUser({ roles: ["TenantAdmin"] });

const fortenantFeature = defineFeature("fortenant", (r) => {
  r.entity("note", noteEntity);

  r.writeHandler(
    defineWriteHandler({
      name: "put-note",
      schema: z.object({ targetTenantId: z.string(), label: z.string() }),
      access: { roles: ["TenantAdmin", "SystemAdmin"] },
      handler: async (event, ctx) => {
        if (!ctx.forTenant) throw new Error("ctx.forTenant missing");
        const { db, streamTenantId } = ctx.forTenant(event.payload.targetTenantId as TenantId); // @cast-boundary engine-payload
        const created = await noteExecutor.create({ label: event.payload.label }, event.user, db, {
          streamTenantId,
        });
        if (!created.isSuccess) return created;
        return {
          isSuccess: true as const,
          data: { id: String(created.data.id), streamTenantId: streamTenantId ?? null },
        };
      },
    }),
  );

  r.writeHandler(
    defineWriteHandler({
      name: "labels-of",
      schema: z.object({ targetTenantId: z.string() }),
      access: { roles: ["SystemAdmin"] },
      handler: async (event, ctx) => {
        if (!ctx.forTenant) throw new Error("ctx.forTenant missing");
        const { db } = ctx.forTenant(event.payload.targetTenantId as TenantId); // @cast-boundary engine-payload
        const rows = await db.selectMany<{ label: string }>(noteTable);
        return {
          isSuccess: true as const,
          data: {
            mode: db.mode,
            tenantId: db.tenantId,
            labels: rows.map((row) => row.label).sort(),
          },
        };
      },
    }),
  );

  r.queryHandler(
    "has-for-tenant",
    z.object({}),
    async (_query, ctx) => ({ offered: ctx.forTenant !== undefined }),
    { access: { roles: ["SystemAdmin"] } },
  );
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [fortenantFeature] });
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack, ["read_fortenant_notes"]);
});

type EventRow = { type: string; tenantId: string; createdBy: string };

async function eventsOf(aggregateId: string): Promise<readonly EventRow[]> {
  return selectMany<EventRow>(stack.db, eventsTable, { aggregateId });
}

describe("ctx.forTenant", () => {
  test("a TenantAdmin is denied for a foreign tenant and no event is written", async () => {
    const eventsBefore = await selectMany(stack.db, eventsTable);

    const error = await stack.http.writeErr(
      "fortenant:write:put-note",
      { targetTenantId: foreignTenantId, label: "sneak" },
      tenantAdmin,
    );
    expect(error.code).toBe("access_denied");
    expect(JSON.stringify(error)).toContain(FrameworkReasons.tenantOverrideRequiresSystemAdmin);

    expect(await selectMany(stack.db, eventsTable)).toHaveLength(eventsBefore.length);
    expect(await selectMany(stack.db, noteTable)).toHaveLength(0);
  });

  test("a SystemAdmin create lands in the foreign tenant's stream with the operator as actor", async () => {
    const created = await stack.http.writeOk<{ id: string; streamTenantId: string | null }>(
      "fortenant:write:put-note",
      { targetTenantId: foreignTenantId, label: "into-foreign" },
      systemAdmin,
    );
    expect(created.streamTenantId).toBe(foreignTenantId);

    const events = await eventsOf(created.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.tenantId).toBe(foreignTenantId);
    expect(events[0]?.createdBy).toBe(systemAdmin.id);

    const rows = await selectMany<{ tenantId: string }>(stack.db, noteTable, { id: created.id });
    expect(rows[0]?.tenantId).toBe(foreignTenantId);
  });

  test("the caller's own tenant needs no privilege and carries no stream override", async () => {
    const created = await stack.http.writeOk<{ id: string; streamTenantId: string | null }>(
      "fortenant:write:put-note",
      { targetTenantId: ownTenantId, label: "own" },
      tenantAdmin,
    );
    expect(created.streamTenantId).toBeNull();

    const events = await eventsOf(created.id);
    expect(events[0]?.tenantId).toBe(ownTenantId);
  });

  test("the foreign db is tenant mode bound to the target and only sees its rows", async () => {
    await stack.http.writeOk(
      "fortenant:write:put-note",
      { targetTenantId: ownTenantId, label: "own-row" },
      systemAdmin,
    );
    await stack.http.writeOk(
      "fortenant:write:put-note",
      { targetTenantId: foreignTenantId, label: "foreign-row" },
      systemAdmin,
    );

    const seen = await stack.http.writeOk<{ mode: string; tenantId: string; labels: string[] }>(
      "fortenant:write:labels-of",
      { targetTenantId: foreignTenantId },
      systemAdmin,
    );
    expect(seen.mode).toBe("tenant");
    expect(seen.tenantId).toBe(foreignTenantId);
    expect(seen.labels).toEqual(["foreign-row"]);
  });

  test("query handlers are not offered a cross-tenant write target", async () => {
    const seen = await stack.http.queryOk<{ offered: boolean }>(
      "fortenant:query:has-for-tenant",
      {},
      systemAdmin,
    );
    expect(seen.offered).toBe(false);
  });
});

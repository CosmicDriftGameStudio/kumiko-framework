// lockedWhen: a stored row whose state meets the entity condition cannot be
// changed or deleted by any write handler (CRUD, custom, nested ctx.write),
// while the write that sets the lock itself passes.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor.js";
import { asRawClient } from "../../db/query-api.js";
import { buildEntityTable } from "../../db/table-builder.js";
import {
  createEntity,
  createSelectField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityUpdateHandler,
  defineFeature,
  defineWriteHandler,
} from "../../engine/index.js";
import { loadAggregate } from "../../event-store/index.js";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack/index.js";

const ticketEntity = createEntity({
  table: "read_lock_tickets",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    status: createSelectField({ options: ["open", "closed"] as const, default: "open" }),
  },
  lockedWhen: { field: "status", eq: "closed" },
});
const ticketTable = buildEntityTable("ticket", ticketEntity);

const ROLES = { access: { roles: ["Admin"] } } as const;

const lockFeature = defineFeature("lock", (r) => {
  r.entity("ticket", ticketEntity);
  r.writeHandler(defineEntityCreateHandler("ticket", ticketEntity, ROLES));
  r.writeHandler(defineEntityUpdateHandler("ticket", ticketEntity, ROLES));
  r.writeHandler(defineEntityDeleteHandler("ticket", ticketEntity, ROLES));
  r.queryHandler(defineEntityDetailHandler("ticket", ticketEntity, ROLES));

  const executor = createEventStoreExecutor(ticketTable, ticketEntity, { entityName: "ticket" });

  r.writeHandler(
    "ticket:rename",
    z.object({ id: z.uuid(), version: z.number(), title: z.string() }),
    async (event, ctx) =>
      executor.update(
        {
          id: event.payload.id,
          version: event.payload.version,
          changes: { title: event.payload.title },
        },
        event.user,
        ctx.db,
      ),
    ROLES,
  );

  r.writeHandler(
    "ticket:rename-nested",
    z.object({ id: z.uuid(), version: z.number(), title: z.string() }),
    async (event, ctx) => ctx.write("lock:write:ticket:rename", event.payload),
    ROLES,
  );

  r.writeHandler(
    defineWriteHandler({
      name: "ticket:reopen",
      schema: z.object({ id: z.uuid(), version: z.number() }),
      access: ROLES.access,
      unsafeSkipLockGuard: true,
      handler: async (event, ctx) =>
        executor.update(
          { id: event.payload.id, version: event.payload.version, changes: { status: "open" } },
          event.user,
          ctx.db,
        ),
    }),
  );
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [lockFeature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, ticketEntity, "ticket");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await asRawClient(stack.db).unsafe(
    `TRUNCATE kumiko_events, read_lock_tickets, kumiko_event_consumers RESTART IDENTITY CASCADE`,
  );
  await stack.eventDispatcher?.ensureRegistered();
});

async function createTicket(status: "open" | "closed" = "open"): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "lock:write:ticket:create",
    { title: "t", status },
    admin,
  );
  return created.id;
}

async function eventCount(id: string): Promise<number> {
  return (await loadAggregate(stack.db, id, admin.tenantId)).length;
}

async function expectLocked(
  type: string,
  payload: Record<string, unknown>,
  id: string,
): Promise<void> {
  const before = await eventCount(id);
  const err = await stack.http.writeErr(type, payload, admin);
  expect(err.httpStatus).toBe(409);
  expect(err.code).toBe("record_locked");
  expect(err.i18nKey).toBe("errors.recordLocked");
  expect(await eventCount(id)).toBe(before);
}

describe("lockedWhen", () => {
  test("update and delete of a locked record are rejected with 409 and write no event", async () => {
    const id = await createTicket("closed");
    await expectLocked(
      "lock:write:ticket:update",
      { id, version: 1, changes: { title: "changed" } },
      id,
    );
    await expectLocked("lock:write:ticket:delete", { id, version: 1 }, id);
    const detail = await stack.http.queryOk<{ title: string }>(
      "lock:query:ticket:detail",
      { id },
      admin,
    );
    expect(detail.title).toBe("t");
  });

  test("the write that sets the lock passes, the next write is rejected", async () => {
    const id = await createTicket();
    await stack.http.writeOk(
      "lock:write:ticket:update",
      { id, version: 1, changes: { status: "closed" } },
      admin,
    );
    await expectLocked(
      "lock:write:ticket:update",
      { id, version: 2, changes: { title: "late" } },
      id,
    );
  });

  test("an open record stays editable and deletable", async () => {
    const id = await createTicket();
    await stack.http.writeOk(
      "lock:write:ticket:update",
      { id, version: 1, changes: { title: "changed" } },
      admin,
    );
    await stack.http.writeOk("lock:write:ticket:delete", { id, version: 2 }, admin);
  });

  test("a custom write handler on a locked record is rejected", async () => {
    const id = await createTicket("closed");
    await expectLocked("lock:write:ticket:rename", { id, version: 1, title: "x" }, id);
  });

  test("a nested ctx.write into a locked record is rejected", async () => {
    const id = await createTicket("closed");
    await expectLocked("lock:write:ticket:rename-nested", { id, version: 1, title: "x" }, id);
  });

  test("a handler with unsafeSkipLockGuard may unlock", async () => {
    const id = await createTicket("closed");
    await stack.http.writeOk("lock:write:ticket:reopen", { id, version: 1 }, admin);
    await stack.http.writeOk(
      "lock:write:ticket:update",
      { id, version: 2, changes: { title: "after reopen" } },
      admin,
    );
  });
});

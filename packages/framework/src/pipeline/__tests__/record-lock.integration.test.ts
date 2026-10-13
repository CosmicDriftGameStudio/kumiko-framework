// lockedWhen: a stored row whose state meets the entity condition cannot be
// changed or deleted through the event-store executor, whatever the calling
// handler returns (CRUD, custom, nested ctx.write), while the write that sets
// the lock itself passes. A call site opts out per executor call.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor.js";
import { asRawClient } from "../../db/query-api.js";
import { buildEntityTable } from "../../db/table-builder.js";
import {
  createBooleanField,
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityUpdateHandler,
  defineFeature,
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
    // Two-word name on purpose: the guard reads the stored row, which must be camelCase.
    isAcknowledged: createBooleanField({ default: false }),
  },
  lockedWhen: { field: "isAcknowledged", eq: true },
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

  // Return something other than the lifecycle result: the guard must not depend on it.
  r.writeHandler(
    "ticket:rename-quiet",
    z.object({ id: z.uuid(), version: z.number(), title: z.string() }),
    async (event, ctx) => {
      const result = await executor.update(
        {
          id: event.payload.id,
          version: event.payload.version,
          changes: { title: event.payload.title },
        },
        event.user,
        ctx.db,
      );
      if (!result.isSuccess) return result;
      return { isSuccess: true as const, data: { ok: true } };
    },
    ROLES,
  );

  r.writeHandler(
    "ticket:purge-quiet",
    z.object({ id: z.uuid() }),
    async (event, ctx) => {
      const result = await executor.delete({ id: event.payload.id }, event.user, ctx.db);
      if (!result.isSuccess) return result;
      return { isSuccess: true as const, data: { ok: true } };
    },
    ROLES,
  );

  r.writeHandler(
    "ticket:reopen",
    z.object({ id: z.uuid(), version: z.number() }),
    async (event, ctx) =>
      executor.update(
        {
          id: event.payload.id,
          version: event.payload.version,
          changes: { isAcknowledged: false },
        },
        event.user,
        ctx.db,
        { unsafeSkipLockGuard: true },
      ),
    ROLES,
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

async function createTicket(state: "open" | "closed" = "open"): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "lock:write:ticket:create",
    { title: "t", isAcknowledged: state === "closed" },
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
      { id, version: 1, changes: { isAcknowledged: true } },
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

  test("a custom handler that returns something else than the lifecycle result is rejected too", async () => {
    const id = await createTicket("closed");
    await expectLocked("lock:write:ticket:rename-quiet", { id, version: 1, title: "x" }, id);
    await expectLocked("lock:write:ticket:purge-quiet", { id }, id);
  });

  test("an executor call with unsafeSkipLockGuard may unlock", async () => {
    const id = await createTicket("closed");
    await stack.http.writeOk("lock:write:ticket:reopen", { id, version: 1 }, admin);
    await stack.http.writeOk(
      "lock:write:ticket:update",
      { id, version: 2, changes: { title: "after reopen" } },
      admin,
    );
  });
});

// lockedWhen: a stored row whose state meets the entity condition cannot be
// changed or deleted through the event-store executor, whatever the calling
// handler returns (CRUD, custom, nested ctx.write), while the write that sets
// the lock itself passes. A call site opts out per executor call.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createEventStoreExecutor, WritePurposes } from "../../db/event-store-executor.js";
import { asRawClient } from "../../db/query.js";
import { buildEntityTable } from "../../db/table-builder.js";
import {
  createBooleanField,
  createEntity,
  createSystemUser,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityUpdateHandler,
  defineFeature,
} from "../../engine/index.js";
import { loadAggregate } from "../../event-store/index.js";
import { TestUsers } from "../../seeding/seed-users.js";

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
// A hard delete or forget from a custom handler is irreversible and needs agent risk "high".
const IRREVERSIBLE = { ...ROLES, agent: { risk: "high" } } as const;

const lockFeature = defineFeature("lock", (r) => {
  r.entity({ name: "ticket", ...ticketEntity });
  r.writeHandler(defineEntityCreateHandler("ticket", ticketEntity, ROLES));
  r.writeHandler(defineEntityUpdateHandler("ticket", ticketEntity, ROLES));
  r.writeHandler(defineEntityDeleteHandler("ticket", ticketEntity, ROLES));
  r.queryHandler(defineEntityDetailHandler("ticket", ticketEntity, ROLES));

  const executor = createEventStoreExecutor(ticketTable, ticketEntity, { entityName: "ticket" });

  r.writeHandler({
    name: "ticket:rename",
    schema: z.object({ id: z.uuid(), version: z.number(), title: z.string() }),
    handler: async (event, ctx) =>
      executor.update(
        {
          id: event.payload.id,
          version: event.payload.version,
          changes: { title: event.payload.title },
        },
        event.user,
        ctx.db,
      ),
    ...ROLES,
  });

  r.writeHandler({
    name: "ticket:rename-nested",
    schema: z.object({ id: z.uuid(), version: z.number(), title: z.string() }),
    handler: async (event, ctx) => ctx.write("lock:write:ticket:rename", event.payload),
    ...ROLES,
  });

  // Return something other than the lifecycle result: the guard must not depend on it.
  r.writeHandler({
    name: "ticket:rename-quiet",
    schema: z.object({ id: z.uuid(), version: z.number(), title: z.string() }),
    handler: async (event, ctx) => {
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
    ...ROLES,
  });

  r.writeHandler({
    name: "ticket:purge-quiet",
    schema: z.object({ id: z.uuid() }),
    handler: async (event, ctx) => {
      const result = await executor.delete({ id: event.payload.id }, event.user, ctx.db);
      if (!result.isSuccess) return result;
      return { isSuccess: true as const, data: { ok: true } };
    },
    ...IRREVERSIBLE,
  });

  r.writeHandler({
    name: "ticket:erase",
    schema: z.object({ id: z.uuid() }),
    handler: async (event, ctx) => {
      const result = await executor.forget({ id: event.payload.id }, event.user, ctx.db);
      if (!result.isSuccess) return result;
      return { isSuccess: true as const, data: { ok: true } };
    },
    ...IRREVERSIBLE,
  });

  // Framework system-user writes: the purpose decides whether the lock applies.
  r.writeHandler({
    name: "ticket:system-rename",
    schema: z.object({ id: z.uuid(), title: z.string(), purpose: z.enum(["none", "erasure"]) }),
    handler: async (event, ctx) =>
      executor.update(
        { id: event.payload.id, changes: { title: event.payload.title } },
        createSystemUser(event.user.tenantId),
        ctx.db,
        {
          skipOptimisticLock: true,
          ...(event.payload.purpose === "erasure" && { writePurpose: WritePurposes.erasure }),
        },
      ),
    ...ROLES,
  });

  r.writeHandler({
    name: "ticket:user-rename-with-purpose",
    schema: z.object({ id: z.uuid(), title: z.string() }),
    handler: async (event, ctx) =>
      executor.update(
        { id: event.payload.id, changes: { title: event.payload.title } },
        event.user,
        ctx.db,
        { skipOptimisticLock: true, writePurpose: WritePurposes.erasure },
      ),
    ...ROLES,
  });

  r.writeHandler({
    name: "ticket:reopen",
    schema: z.object({ id: z.uuid(), version: z.number() }),
    handler: async (event, ctx) =>
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
    ...ROLES,
  });
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

  test("an unsafeSkipLockGuard in the request payload cannot unlock the generic update", async () => {
    const id = await createTicket("closed");
    await expectLocked(
      "lock:write:ticket:update",
      { id, version: 1, changes: { title: "x" }, unsafeSkipLockGuard: true },
      id,
    );
    const before = await eventCount(id);
    const err = await stack.http.writeErr(
      "lock:write:ticket:update",
      { id, version: 1, changes: { title: "x", unsafeSkipLockGuard: true } },
      admin,
    );
    expect(err.httpStatus).toBeGreaterThanOrEqual(400);
    expect(await eventCount(id)).toBe(before);
  });

  test("permission is checked before the lock, so a locked record leaks nothing", async () => {
    const id = await createTicket("closed");
    const update = (target: string) => ({ id: target, version: 1, changes: { title: "x" } });

    const noRole = await stack.http.writeErr(
      "lock:write:ticket:update",
      update(id),
      TestUsers.user,
    );
    expect(noRole.httpStatus).toBe(403);

    const missing = await stack.http.writeErr(
      "lock:write:ticket:update",
      update(crypto.randomUUID()),
      TestUsers.otherTenant,
    );
    const foreign = await stack.http.writeErr(
      "lock:write:ticket:update",
      update(id),
      TestUsers.otherTenant,
    );
    expect(foreign.code).not.toBe("record_locked");
    expect({ status: foreign.httpStatus, code: foreign.code }).toEqual({
      status: missing.httpStatus,
      code: missing.code,
    });
    expect(await eventCount(id)).toBe(1);
  });

  test("forget (Art. 17) erases a locked record without any option", async () => {
    const id = await createTicket("closed");
    await stack.http.writeOk("lock:write:ticket:erase", { id }, admin);
    const rows = await asRawClient(stack.db).unsafe(
      "SELECT id FROM read_lock_tickets WHERE id = $1",
      [id],
    );
    expect(rows).toHaveLength(0);
  });

  test("a system-user write without a writePurpose is rejected on a locked record", async () => {
    const id = await createTicket("closed");
    await expectLocked("lock:write:ticket:system-rename", { id, title: "x", purpose: "none" }, id);
  });

  test("a system-user write with writePurpose erasure reaches a locked record", async () => {
    const id = await createTicket("closed");
    await stack.http.writeOk(
      "lock:write:ticket:system-rename",
      { id, title: "anonymised", purpose: "erasure" },
      admin,
    );
    const detail = await stack.http.queryOk<{ title: string }>(
      "lock:query:ticket:detail",
      { id },
      admin,
    );
    expect(detail.title).toBe("anonymised");
  });

  test("a regular user cannot use a writePurpose to pass the lock", async () => {
    const id = await createTicket("closed");
    await expectLocked("lock:write:ticket:user-rename-with-purpose", { id, title: "x" }, id);
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

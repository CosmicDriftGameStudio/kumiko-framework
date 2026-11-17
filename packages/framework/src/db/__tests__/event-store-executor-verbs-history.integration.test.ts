// Named entity verbs (`verbs` + update({ verb })) and the executor's history/listAsOf reads,
// driven through real handlers over HTTP.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { parseTenantId } from "@cosmicdrift/kumiko-types/identifiers";
import * as z from "zod";
import {
  createEntity,
  createSelectField,
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import type { SessionUser } from "../../engine/types/index.ts";
import { rebuildProjection } from "../../pipeline/index.ts";
import { TestUsers, testTenantId } from "../../seeding/seed-users.ts";
import { createEventStoreExecutor } from "../event-store-executor.ts";
import { selectMany } from "../query.ts";
import { buildEntityTable } from "../table-builder.ts";

const ticketEntity = createEntity({
  name: "ticket",
  table: "read_verbhist_tickets",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    status: createSelectField({ options: ["open", "closed", "archived"], default: "open" }),
    internalNote: createTextField({
      personal: false,
      reason: "test_fixture",
      access: { read: { Admin: "all" } },
    }),
  },
  transitions: { status: { open: ["closed", "archived"], closed: ["archived"] } },
  verbs: {
    archived: { transition: { field: "status", from: ["open", "closed"], to: "archived" } },
    flagged: {},
  },
});
const ticketTable = buildEntityTable(ticketEntity);

const verbFeature = defineFeature("verbhist", (r) => {
  r.entity(ticketEntity);
  const exec = createEventStoreExecutor(ticketTable, ticketEntity, { entityName: "ticket" });
  const idPayload = z.object({ id: z.uuid() });
  const access = { roles: ["Admin", "User"] };

  r.writeHandler({
    name: "ticket:create",
    schema: z.object({ title: z.string() }),
    handler: async (event, ctx) => exec.create(event.payload, event.user, ctx.db),
    access,
  });
  r.writeHandler({
    name: "ticket:archive",
    schema: idPayload,
    handler: async (event, ctx) =>
      exec.update({ id: event.payload.id, changes: {} }, event.user, ctx.db, {
        skipOptimisticLock: true,
        verb: "archived",
      }),
    access,
  });
  r.writeHandler({
    name: "ticket:flag",
    schema: z.object({ id: z.uuid(), internalNote: z.string() }),
    handler: async (event, ctx) =>
      exec.update(
        { id: event.payload.id, changes: { internalNote: event.payload.internalNote } },
        event.user,
        ctx.db,
        { skipOptimisticLock: true, verb: "flagged" },
      ),
    access,
  });
  r.writeHandler({
    name: "ticket:bogus",
    schema: idPayload,
    handler: async (event, ctx) =>
      exec.update({ id: event.payload.id, changes: {} }, event.user, ctx.db, {
        skipOptimisticLock: true,
        verb: "nope",
      }),
    access,
  });
  r.writeHandler({
    name: "ticket:delete",
    schema: idPayload,
    handler: async (event, ctx) => exec.delete({ id: event.payload.id }, event.user, ctx.db),
    access,
  });
  r.queryHandler({
    name: "ticket:events",
    schema: idPayload,
    handler: async (query, ctx) => ctx.events.load(query.payload.id),
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
  r.queryHandler({
    name: "ticket:history",
    schema: idPayload,
    handler: async (query, ctx) => exec.history({ id: query.payload.id }, query.user, ctx.db),
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
  r.queryHandler({
    name: "ticket:history-of-tenant",
    schema: z.object({ id: z.uuid(), tenantId: z.uuid() }),
    handler: async (query, ctx) =>
      exec.history({ id: query.payload.id }, query.user, ctx.db, {
        streamTenantId: parseTenantId(query.payload.tenantId) ?? undefined,
      }),
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
  r.queryHandler({
    name: "ticket:as-of",
    schema: z.object({ asOf: z.iso.datetime() }),
    handler: async (query, ctx) =>
      exec.listAsOf({ asOf: Temporal.Instant.from(query.payload.asOf) }, query.user, ctx.db),
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
});

type StoredEventView = {
  readonly type: string;
  readonly createdAt: string;
  readonly payload: {
    readonly changes?: Record<string, unknown>;
    readonly previous?: Record<string, unknown>;
  };
};
type HistoryEntryView = {
  readonly version: number;
  readonly at: string;
  readonly by: string;
  readonly verb: string;
  readonly changes: Record<string, unknown>;
};
type AsOfRow = { readonly id: string; readonly status: string };

const IMPLICIT_PROJECTION = "verbhist:projection:ticket-entity";
const admin = TestUsers.admin;
const plainUser = TestUsers.user;
let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [verbFeature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, ticketEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack, ["read_verbhist_tickets"]);
});

async function createTicket(title = "Broken"): Promise<string> {
  const { id } = await stack.http.writeOk<{ id: string }>(
    "verbhist:write:ticket:create",
    { title },
    admin,
  );
  return id;
}

async function rowOf(id: string): Promise<Record<string, unknown>> {
  const rows = await selectMany<Record<string, unknown>>(stack.db, ticketTable, {});
  const row = rows.find((candidate) => candidate["id"] === id);
  if (row === undefined) throw new Error(`row ${id} missing`);
  return row;
}

function eventsOf(id: string): Promise<StoredEventView[]> {
  return stack.http.queryOk<StoredEventView[]>("verbhist:query:ticket:events", { id }, admin);
}

function historyOf(id: string, user: SessionUser = admin): Promise<HistoryEntryView[] | null> {
  return stack.http.queryOk<HistoryEntryView[] | null>(
    "verbhist:query:ticket:history",
    { id },
    user,
  );
}

async function ticketsAsOf(asOf: string): Promise<AsOfRow[]> {
  return stack.http.queryOk<AsOfRow[]>("verbhist:query:ticket:as-of", { asOf }, admin);
}

function entryOf(history: readonly HistoryEntryView[] | null, verb: string): HistoryEntryView {
  const entry = history?.find((candidate) => candidate.verb === verb);
  if (entry === undefined) throw new Error(`history entry ${verb} missing`);
  return entry;
}

describe("named entity verbs", () => {
  test("a verb with a transition appends <entity>.<verb>, sets the field and moves the version", async () => {
    const id = await createTicket();
    const before = await rowOf(id);

    await stack.http.writeOk("verbhist:write:ticket:archive", { id }, admin);

    const archived = (await eventsOf(id)).find((event) => event.type === "ticket.archived");
    expect(archived?.payload.changes?.["status"]).toBe("archived");
    expect(archived?.payload.previous?.["status"]).toBe("open");
    const after = await rowOf(id);
    expect(after["status"]).toBe("archived");
    expect(after["version"]).toBe(Number(before["version"]) + 1);
  });

  test("a second archive is an invalid transition and appends nothing", async () => {
    const id = await createTicket();
    await stack.http.writeOk("verbhist:write:ticket:archive", { id }, admin);
    const eventCount = (await eventsOf(id)).length;

    const second = await stack.http.write("verbhist:write:ticket:archive", { id }, admin);

    expect(second.status).toBe(422);
    expect(JSON.stringify(await second.json())).toContain("invalid_transition");
    expect((await eventsOf(id)).length).toBe(eventCount);
  });

  test("an undeclared verb is a server error", async () => {
    const id = await createTicket();
    const res = await stack.http.write("verbhist:write:ticket:bogus", { id }, admin);
    expect(res.status).toBe(500);
  });

  test("a rebuild of the implicit projection reproduces the row", async () => {
    const id = await createTicket();
    await stack.http.writeOk("verbhist:write:ticket:flag", { id, internalNote: "check" }, admin);
    await stack.http.writeOk("verbhist:write:ticket:archive", { id }, admin);
    const before = await rowOf(id);

    await rebuildProjection(IMPLICIT_PROJECTION, { db: stack.db, registry: stack.registry });

    expect(await rowOf(id)).toEqual(before);
  });
});

describe("executor history", () => {
  test("an admin sees lifecycle and verb events in stream order", async () => {
    const id = await createTicket();
    await stack.http.writeOk("verbhist:write:ticket:flag", { id, internalNote: "check" }, admin);
    await stack.http.writeOk("verbhist:write:ticket:archive", { id }, admin);

    const history = await historyOf(id);

    expect(history?.map((entry) => entry.verb)).toEqual(["created", "flagged", "archived"]);
    const versions = history?.map((entry) => entry.version) ?? [];
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(3);
    for (const entry of history ?? []) {
      expect(entry.by).toBe(admin.id);
      expect(Number.isNaN(Temporal.Instant.from(entry.at).epochMilliseconds)).toBe(false);
    }
    expect(entryOf(history, "flagged").changes["internalNote"]).toBe("check");
  });

  test("a role without read rights on a field does not see it in the history", async () => {
    const id = await createTicket();
    await stack.http.writeOk("verbhist:write:ticket:flag", { id, internalNote: "secret" }, admin);

    const history = await historyOf(id, plainUser);

    expect(entryOf(history, "flagged").changes).not.toHaveProperty("internalNote");
    expect(JSON.stringify(history)).not.toContain("secret");
  });

  test("history refuses a streamTenantId the db is not bound to", async () => {
    const id = await createTicket();

    const error = await stack.http.queryErr(
      "verbhist:query:ticket:history-of-tenant",
      { id, tenantId: testTenantId(2) },
      admin,
    );

    expect(error.httpStatus).toBe(403);
  });

  test("an unknown id has no history", async () => {
    expect(await historyOf("0b9c6c3a-5c1e-4a6e-9a39-2f1d6c1f7a10")).toBeNull();
  });
});

describe("executor listAsOf", () => {
  test("rows are folded up to the instant of an event", async () => {
    const id = await createTicket();
    await stack.http.writeOk("verbhist:write:ticket:archive", { id }, admin);
    const history = await historyOf(id);

    const atCreated = await ticketsAsOf(entryOf(history, "created").at);
    const atArchived = await ticketsAsOf(entryOf(history, "archived").at);

    expect(atCreated.find((row) => row.id === id)?.status).toBe("open");
    expect(atArchived.find((row) => row.id === id)?.status).toBe("archived");
  });

  test("a hard-deleted row is gone from the delete instant on, but present before", async () => {
    const id = await createTicket();
    const createdAt = entryOf(await historyOf(id), "created").at;
    await stack.http.writeOk("verbhist:write:ticket:delete", { id }, admin);
    const deleted = (await eventsOf(id)).find((event) => event.type === "ticket.deleted");
    if (deleted === undefined) throw new Error("expected a deleted event");

    const atDelete = await ticketsAsOf(deleted.createdAt);
    const atCreated = await ticketsAsOf(createdAt);

    expect(atDelete.some((row) => row.id === id)).toBe(false);
    expect(atCreated.some((row) => row.id === id)).toBe(true);
  });
});

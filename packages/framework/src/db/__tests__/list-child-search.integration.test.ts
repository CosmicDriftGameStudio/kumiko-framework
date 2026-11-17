// A list search on the parent also matches through child rows (hasMany searchable: true), but only
// through children the viewer may read whose detail handler admits them, with every searchable
// child field readable by them.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  defineEntityQueryHandler,
  defineEntityWriteHandler,
} from "../../engine/entity-handlers.ts";
import {
  createEntity,
  createReferenceField,
  createTextField,
  defineFeature,
  from,
} from "../../engine/index.ts";
import type { SessionUser } from "../../engine/types/index.ts";
import { createTestUser, TestUsers, testTenantId } from "../../seeding/seed-users.ts";

const ticketEntity = createEntity({
  name: "ticket",
  table: "read_helpdesk_tickets",
  fields: {
    subject: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      searchable: true,
    }),
  },
});

const replyEntity = createEntity({
  name: "reply",
  table: "read_helpdesk_replies",
  fields: {
    ticketId: createReferenceField({ entity: "ticket", personal: false, reason: "test_fixture" }),
    authorId: createTextField({ personal: false, reason: "test_fixture", required: true }),
    body: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      searchable: true,
    }),
  },
  access: {
    read: { Admin: "all", Agent: from("user:id", "authorId") },
    write: { Admin: "all" },
  },
});

const secretReplyEntity = createEntity({
  name: "secretReply",
  table: "read_helpdesk_secret_replies",
  fields: {
    ticketId: createReferenceField({ entity: "ticket", personal: false, reason: "test_fixture" }),
    body: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      searchable: true,
      access: { read: { Admin: "all" } },
    }),
  },
});

const internalNoteEntity = createEntity({
  name: "internalNote",
  table: "read_helpdesk_internal_notes",
  fields: {
    ticketId: createReferenceField({ entity: "ticket", personal: false, reason: "test_fixture" }),
    body: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      searchable: true,
    }),
  },
});

const draftNoteEntity = createEntity({
  name: "draftNote",
  table: "read_helpdesk_draft_notes",
  fields: {
    ticketId: createReferenceField({ entity: "ticket", personal: false, reason: "test_fixture" }),
    body: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      searchable: true,
    }),
  },
});

const roles = ["Admin", "Agent"] as const;

const helpdeskFeature = defineFeature("helpdesk", (r) => {
  const ticket = r.entity(ticketEntity);
  r.entity(replyEntity);
  r.entity(secretReplyEntity);
  r.relation({ entity: ticket, name: "replies", type: "hasMany",
    target: "reply",
    foreignKey: "ticketId",
    searchable: true });
  r.relation({ entity: ticket, name: "secretReplies", type: "hasMany",
    target: "secretReply",
    foreignKey: "ticketId",
    searchable: true });
  r.entity(internalNoteEntity);
  r.relation({ entity: ticket, name: "internalNotes", type: "hasMany",
    target: "internalNote",
    foreignKey: "ticketId",
    searchable: true });
  r.entity(draftNoteEntity);
  r.relation({ entity: ticket, name: "draftNotes", type: "hasMany",
    target: "draftNote",
    foreignKey: "ticketId",
    searchable: true });
  const access = { access: { roles: [...roles] } };
  const writeAccess = { access: { roles: ["Admin"] } };
  r.writeHandler(defineEntityWriteHandler("ticket:create", ticketEntity, writeAccess));
  r.writeHandler(defineEntityWriteHandler("reply:create", replyEntity, writeAccess));
  r.writeHandler(defineEntityWriteHandler("secretReply:create", secretReplyEntity, writeAccess));
  r.writeHandler(defineEntityWriteHandler("internalNote:create", internalNoteEntity, writeAccess));
  r.writeHandler(defineEntityWriteHandler("draftNote:create", draftNoteEntity, writeAccess));
  r.queryHandler(defineEntityQueryHandler("ticket:list", ticketEntity, access));
  r.queryHandler(defineEntityQueryHandler("reply:detail", replyEntity, access));
  r.queryHandler(defineEntityQueryHandler("secretReply:detail", secretReplyEntity, access));
  r.queryHandler(
    defineEntityQueryHandler("internalNote:detail", internalNoteEntity, {
      access: { roles: ["Admin"] },
    }),
  );
  r.queryHandler(defineEntityQueryHandler("draftNote:list", draftNoteEntity, access));
});

const tenant = testTenantId(1);
const admin: SessionUser = { ...TestUsers.admin, tenantId: tenant };
const agentA = mkAgent(1);
const agentB = mkAgent(2);

function mkAgent(n: number): SessionUser {
  return createTestUser({
    id: `44444444-0000-4000-8000-00000000000${n}`,
    tenantId: tenant,
    roles: ["Agent"],
  });
}

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [helpdeskFeature] });
  await unsafeCreateEntityTable(stack.db, ticketEntity, "ticket");
  await unsafeCreateEntityTable(stack.db, replyEntity, "reply");
  await unsafeCreateEntityTable(stack.db, secretReplyEntity, "secretReply");
  await unsafeCreateEntityTable(stack.db, internalNoteEntity, "internalNote");
  await unsafeCreateEntityTable(stack.db, draftNoteEntity, "draftNote");
});

afterAll(async () => {
  await stack.cleanup();
});

async function createTicket(subject: string): Promise<string> {
  return (
    await stack.http.writeOk<{ id: string }>("helpdesk:write:ticket:create", { subject }, admin)
  ).id;
}

async function createReply(ticketId: string, authorId: string, body: string): Promise<void> {
  await stack.http.writeOk("helpdesk:write:reply:create", { ticketId, authorId, body }, admin);
}

type ListResult = { rows: Array<Record<string, unknown>>; total?: number };

async function search(user: SessionUser, term: string, extra: object = {}): Promise<ListResult> {
  await stack.eventDispatcher?.runOnce();
  return stack.http.queryOk<ListResult>(
    "helpdesk:query:ticket:list",
    { search: term, ...extra },
    user,
  );
}

describe("list search through child rows", () => {
  test("admin finds a ticket through its reply although the subject does not match", async () => {
    const ticketId = await createTicket("Printer broken");
    await createReply(ticketId, agentA.id, "mentions the zebra stripe");
    const result = await search(admin, "zebra");
    expect(result.rows.map((row) => row["id"])).toEqual([ticketId]);
  });

  test("an agent does not find a ticket through another agent's reply", async () => {
    const ticketId = await createTicket("Login problem");
    await createReply(ticketId, agentB.id, "the walrus clue");
    expect((await search(agentA, "walrus")).rows).toHaveLength(0);
    expect((await search(agentB, "walrus")).rows.map((row) => row["id"])).toEqual([ticketId]);
  });

  test("an agent gets no hit through a child whose searchable field it may not read", async () => {
    const ticketId = await createTicket("Invoice question");
    await stack.http.writeOk(
      "helpdesk:write:secretReply:create",
      { ticketId, body: "confidential narwhal note" },
      admin,
    );
    expect((await search(agentA, "narwhal")).rows).toHaveLength(0);
    expect((await search(admin, "narwhal")).rows.map((row) => row["id"])).toEqual([ticketId]);
  });

  test("an agent gets no hit through a child whose detail handler does not admit its role", async () => {
    const ticketId = await createTicket("Shipping delay");
    await stack.http.writeOk(
      "helpdesk:write:internalNote:create",
      { ticketId, body: "ocelot sighting" },
      admin,
    );
    expect((await search(agentA, "ocelot")).rows).toHaveLength(0);
    expect((await search(admin, "ocelot")).rows.map((row) => row["id"])).toEqual([ticketId]);
  });

  test("a child without a detail handler never matches, even with a list handler", async () => {
    const ticketId = await createTicket("Refund request");
    await stack.http.writeOk(
      "helpdesk:write:draftNote:create",
      { ticketId, body: "axolotl draft" },
      admin,
    );
    expect((await search(admin, "axolotl")).rows).toHaveLength(0);
  });

  test("paging stays exact: limit 2 returns two rows with total 3", async () => {
    for (const subject of ["Ticket one", "Ticket two", "Ticket three"]) {
      const ticketId = await createTicket(subject);
      await createReply(ticketId, agentA.id, "shared quokka remark");
    }
    const result = await search(admin, "quokka", { limit: 2, totalCount: true });
    expect(result.rows).toHaveLength(2);
    expect(result.total).toBe(3);
  });
});

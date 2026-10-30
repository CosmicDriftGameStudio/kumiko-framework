// Trash list: `onlyDeleted` returns just the soft-deleted rows, under the same
// tenant/ownership rules as the live list.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createEntity,
  createTextField,
  defineEntityQueryHandler,
  defineEntityWriteHandler,
  defineFeature,
  from,
} from "../engine/index.ts";
import type { SessionUser } from "../engine/types/index.ts";
import { createTestUser, TestUsers, testTenantId } from "../seeding/seed-users.ts";

const tenant = testTenantId(1);

const noteEntity = createEntity({
  table: "trash_notes",
  softDelete: true,
  fields: {
    ownerId: createTextField({ personal: false, reason: "test_fixture", required: true }),
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
  access: {
    read: { Admin: "all", Member: from("user:id", "ownerId") },
    write: { Admin: "all", Member: from("user:id", "ownerId") },
  },
});

const plainEntity = createEntity({
  table: "trash_plain",
  fields: { title: createTextField({ personal: false, reason: "test_fixture", required: true }) },
  access: { read: { Admin: "all" }, write: { Admin: "all" } },
});

const roles = ["Admin", "Member"] as const;

const trashFeature = defineFeature("trashlist", (r) => {
  r.entity({ name: "note", ...noteEntity });
  r.entity({ name: "plain", ...plainEntity });
  for (const verb of ["create", "delete", "restore"] as const) {
    r.writeHandler(
      defineEntityWriteHandler(`note:${verb}`, noteEntity, { access: { roles: [...roles] } }),
    );
  }
  r.writeHandler(
    defineEntityWriteHandler("plain:create", plainEntity, { access: { roles: ["Admin"] } }),
  );
  r.queryHandler(
    defineEntityQueryHandler("note:list", noteEntity, { access: { roles: [...roles] } }),
  );
  r.queryHandler(
    defineEntityQueryHandler("plain:list", plainEntity, { access: { roles: ["Admin"] } }),
  );
});

const admin: SessionUser = { ...TestUsers.admin, tenantId: tenant };
const alice = createTestUser({
  id: "22222222-0000-4000-8000-000000000001",
  tenantId: tenant,
  roles: ["Member"],
});
const bob = createTestUser({
  id: "22222222-0000-4000-8000-000000000002",
  tenantId: tenant,
  roles: ["Member"],
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [trashFeature] });
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
  await unsafeCreateEntityTable(stack.db, plainEntity, "plain");
});

afterAll(async () => {
  await stack.cleanup();
});

type ListResult = { rows: Array<Record<string, unknown>>; total?: number };

function listNotes(user: SessionUser, extra: Record<string, unknown> = {}): Promise<ListResult> {
  return stack.http.queryOk<ListResult>(
    "trashlist:query:note:list",
    { totalCount: true, ...extra },
    user,
  );
}

async function createNote(owner: SessionUser, title: string): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "trashlist:write:note:create",
    { ownerId: owner.id, title },
    admin,
  );
  return created.id;
}

const titles = (r: ListResult): unknown[] => r.rows.map((row) => row["title"]);

describe("list payload onlyDeleted", () => {
  test("delete moves a row from the live list to the trash list; restore moves it back", async () => {
    const id = await createNote(alice, "round-trip");
    expect(titles(await listNotes(admin))).toContain("round-trip");
    expect(titles(await listNotes(admin, { onlyDeleted: true }))).not.toContain("round-trip");

    await stack.http.writeOk("trashlist:write:note:delete", { id }, admin);
    expect(titles(await listNotes(admin))).not.toContain("round-trip");
    const trash = await listNotes(admin, { onlyDeleted: true });
    expect(titles(trash)).toContain("round-trip");
    expect(trash.rows.every((row) => row["isDeleted"] === true)).toBe(true);

    await stack.http.writeOk("trashlist:write:note:restore", { id }, admin);
    expect(titles(await listNotes(admin))).toContain("round-trip");
    expect(titles(await listNotes(admin, { onlyDeleted: true }))).not.toContain("round-trip");
  });

  test("totalCount counts only the deleted rows", async () => {
    const live = await createNote(alice, "count-live");
    const gone = await createNote(alice, "count-gone");
    await stack.http.writeOk("trashlist:write:note:delete", { id: gone }, admin);
    const trash = await listNotes(admin, { onlyDeleted: true });
    expect(trash.total).toBe(trash.rows.length);
    expect(titles(trash)).toContain("count-gone");
    expect(titles(trash)).not.toContain("count-live");
    expect(live).not.toBe(gone);
  });

  test("a foreign owner's deleted row stays invisible", async () => {
    const id = await createNote(alice, "alice-private");
    await stack.http.writeOk("trashlist:write:note:delete", { id }, admin);
    expect(titles(await listNotes(alice, { onlyDeleted: true }))).toContain("alice-private");
    expect(titles(await listNotes(bob, { onlyDeleted: true }))).not.toContain("alice-private");
  });

  test("onlyDeleted together with includeDeleted is a validation error", async () => {
    const err = await stack.http.queryErr(
      "trashlist:query:note:list",
      { onlyDeleted: true, includeDeleted: true },
      admin,
    );
    expectErrorIncludes(err, "validation");
  });

  test("onlyDeleted on an entity without softDelete is a validation error", async () => {
    const err = await stack.http.queryErr(
      "trashlist:query:plain:list",
      { onlyDeleted: true },
      admin,
    );
    expectErrorIncludes(err, "validation");
  });
});

// An entity with only an owner read rule (no access.write) must not let a
// tenant member who cannot read a row change, delete, restore or learn about it.

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
import { createTestUser, testTenantId } from "../seeding/seed-users.ts";

const SECRET_TITLE = "owner-only-secret-title";

const noteEntity = createEntity({
  table: "readrule_notes",
  softDelete: true,
  fields: {
    ownerId: createTextField({ personal: false, reason: "test_fixture", required: true }),
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
  access: { read: { Member: from("user:id", "ownerId") } },
});

const notesFeature = defineFeature("readrulenotes", (r) => {
  r.entity({ name: "note", ...noteEntity });
  for (const verb of ["create", "update", "delete", "restore"] as const) {
    r.writeHandler(
      defineEntityWriteHandler(`note:${verb}`, noteEntity, { access: { roles: ["Member"] } }),
    );
  }
  r.queryHandler(
    defineEntityQueryHandler("note:detail", noteEntity, { access: { roles: ["Member"] } }),
  );
});

function member(n: number): SessionUser {
  return createTestUser({
    id: `22222222-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
    tenantId: testTenantId(1),
    roles: ["Member"],
  });
}

const userA = member(1);
const userB = member(2);

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [notesFeature] });
  await unsafeCreateEntityTable(stack.db, noteEntity, "note");
});

afterAll(async () => {
  await stack.cleanup();
});

async function createNoteOfA(): Promise<{ id: string; version: number }> {
  const res = await stack.http.writeOk<{ id: string; data: { version: number } }>(
    "readrulenotes:write:note:create",
    { ownerId: userA.id, title: SECRET_TITLE },
    userA,
  );
  return { id: res.id, version: res.data.version };
}

async function titleSeenByA(id: string): Promise<string | undefined> {
  const row = await stack.http.queryOk<{ title: string } | null>(
    "readrulenotes:query:note:detail",
    { id },
    userA,
  );
  return row?.title;
}

describe("access.read is enforced on update, delete and restore", () => {
  test("a non-owner cannot update the row: not_found, nothing leaks, row unchanged", async () => {
    const note = await createNoteOfA();
    const err = await stack.http.writeErr(
      "readrulenotes:write:note:update",
      { id: note.id, version: note.version, changes: { title: "hijacked" } },
      userB,
    );
    expectErrorIncludes(err, "not_found");
    expect(JSON.stringify(err)).not.toContain(SECRET_TITLE);
    expect(await titleSeenByA(note.id)).toBe(SECRET_TITLE);
  });

  test("a non-owner cannot delete the row: not_found, no row content returned, row still there", async () => {
    const note = await createNoteOfA();
    const err = await stack.http.writeErr(
      "readrulenotes:write:note:delete",
      { id: note.id },
      userB,
    );
    expectErrorIncludes(err, "not_found");
    expect(JSON.stringify(err)).not.toContain(SECRET_TITLE);
    expect(await titleSeenByA(note.id)).toBe(SECRET_TITLE);
  });

  test("a non-owner cannot restore the owner's deleted row", async () => {
    const note = await createNoteOfA();
    await stack.http.writeOk("readrulenotes:write:note:delete", { id: note.id }, userA);
    const err = await stack.http.writeErr(
      "readrulenotes:write:note:restore",
      { id: note.id },
      userB,
    );
    expectErrorIncludes(err, "not_found");
    expect(await titleSeenByA(note.id)).toBeUndefined();
  });

  test("restore on a live row the caller cannot read answers not_found, not not_deleted", async () => {
    const note = await createNoteOfA();
    const err = await stack.http.writeErr(
      "readrulenotes:write:note:restore",
      { id: note.id },
      userB,
    );
    expectErrorIncludes(err, "not_found");
    expect(JSON.stringify(err)).not.toContain("not_deleted");
  });

  test("the owner can still update, delete and restore", async () => {
    const note = await createNoteOfA();
    await stack.http.writeOk(
      "readrulenotes:write:note:update",
      { id: note.id, version: note.version, changes: { title: "edited" } },
      userA,
    );
    expect(await titleSeenByA(note.id)).toBe("edited");
    await stack.http.writeOk("readrulenotes:write:note:delete", { id: note.id }, userA);
    expect(await titleSeenByA(note.id)).toBeUndefined();
    await stack.http.writeOk("readrulenotes:write:note:restore", { id: note.id }, userA);
    expect(await titleSeenByA(note.id)).toBe("edited");
  });
});

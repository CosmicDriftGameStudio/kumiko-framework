// fw#2626 — `{ kind: "where" }` ownership rules on the WRITE path.
//
// `entity.access.write` is only ever evaluated in memory
// (userCanCreateFieldRow / userCanWriteFieldRow); there is no SQL layer on the
// write path to run a where-rule against, and on create there is not even a
// row yet. Boot validation rejects the shape outright
// (boot-validator/ownership.ts) and setupTestStack now runs that guard too, so
// the rule is installed after the stack is up — that is the only way left to
// reach the runtime path behind the guard and pin it to a fail-closed deny
// instead of a 500.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "../db/query";
import {
  createEntity,
  createTextField,
  defineEntityQueryHandler,
  defineEntityWriteHandler,
  defineFeature,
} from "../engine";
import type { OwnershipRule, SessionUser, WhereRule } from "../engine/types";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "../stack";
import { expectErrorIncludes } from "../testing";

const ownerWhereRule: WhereRule = {
  kind: "where",
  where: (user, ctx) => ({
    sqlText: `${ctx.tableName}.owner_id = $${ctx.paramStart}`,
    params: [user.id],
  }),
};

// Admin keeps a plain rule so the suite can seed rows over real HTTP; Member
// is the shape under test and is swapped in after boot (see beforeAll).
const memoWriteAccess: Record<string, OwnershipRule> = { Admin: "all", Member: "all" };

const memoEntity = createEntity({
  table: "fw2626_memos",
  softDelete: true,
  fields: {
    ownerId: createTextField({ required: true }),
    title: createTextField({ required: true }),
  },
  access: {
    read: { Admin: "all", Member: "all" },
    write: memoWriteAccess,
  },
});

const memosFeature = defineFeature("fw2626memos", (r) => {
  r.entity("memo", memoEntity);
  for (const verb of ["create", "update", "delete"] as const) {
    r.writeHandler(
      defineEntityWriteHandler(`memo:${verb}`, memoEntity, {
        access: { roles: ["Admin", "Member"] },
      }),
    );
  }
  r.queryHandler(
    defineEntityQueryHandler("memo:detail", memoEntity, {
      access: { roles: ["Admin", "Member"] },
    }),
  );
});

const tenant = testTenantId(1);
const admin: SessionUser = { ...TestUsers.admin, tenantId: tenant };
const member = createTestUser({
  id: "22222222-0000-4000-8000-000000002626",
  tenantId: tenant,
  roles: ["Member"],
});

let stack: TestStack;
let seeded: { id: string; version: number };

beforeAll(async () => {
  stack = await setupTestStack({ features: [memosFeature] });
  await unsafeCreateEntityTable(stack.db, memoEntity, "memo");
  memoWriteAccess["Member"] = ownerWhereRule;
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe("DELETE FROM fw2626_memos");
  const row = await stack.http.writeOk<{ id: string; data: { version: number } }>(
    "fw2626memos:write:memo:create",
    { ownerId: member.id, title: "seed" },
    admin,
  );
  seeded = { id: row.id, version: row.data.version };
});

describe("write-path where-rule — create", () => {
  test("create under a where-rule is denied, not a 500", async () => {
    const err = await stack.http.writeErr(
      "fw2626memos:write:memo:create",
      { ownerId: member.id, title: "mine" },
      member,
    );
    expectErrorIncludes(err, "ownership_denied");
    expect(err.httpStatus).toBe(422);
  });
});

describe("write-path where-rule — update/delete", () => {
  test("update under a where-rule stays denied", async () => {
    const err = await stack.http.writeErr(
      "fw2626memos:write:memo:update",
      { id: seeded.id, version: seeded.version, changes: { title: "edited" } },
      member,
    );
    expectErrorIncludes(err, "ownership_denied");
    expect(err.httpStatus).toBe(422);
  });

  test("delete under a where-rule stays denied", async () => {
    const err = await stack.http.writeErr(
      "fw2626memos:write:memo:delete",
      { id: seeded.id },
      member,
    );
    expectErrorIncludes(err, "ownership_denied");
    expect(err.httpStatus).toBe(422);
  });
});

describe("write-path where-rule — sibling roles unaffected", () => {
  test("Admin's plain rule still writes through the same map", async () => {
    const res = await stack.http.writeOk<{ data: { title: string } }>(
      "fw2626memos:write:memo:update",
      { id: seeded.id, version: seeded.version, changes: { title: "by-admin" } },
      admin,
    );
    expect(res.data.title).toBe("by-admin");
  });
});

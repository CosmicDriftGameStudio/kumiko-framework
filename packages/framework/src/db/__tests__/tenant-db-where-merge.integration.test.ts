// The security-critical WHERE merge (caller-`where.tenantId`
// may only NARROW the tenant scope, never expand it) is tested here
// against real Postgres through the full HTTP path (setupTestStack),
// rather than only as an SQL-string pin against the recording fake
// (tenant-db-where-merge.test.ts remains as a fast pin).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { updateRows } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineFeature,
} from "../../engine/index.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";
import { selectMany } from "../query.ts";
import { buildEntityTable } from "../table-builder.ts";

const noteEntity = createEntity({
  fields: {
    title: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
  table: "where_merge_notes",
});
const noteTable = buildEntityTable("note", noteEntity);

// The handlers pass a CALLER-CONTROLLED where.tenantId into TenantDb —
// exactly the attack vector that the merge must neutralize.
const probeFeature = defineFeature("where-merge-probe", (r) => {
  r.entity({ name: "note", ...noteEntity });
  r.writeHandler(defineEntityCreateHandler("note", noteEntity, { access: { roles: ["User"] } }));

  r.queryHandler({
    name: "list-for-tenant",
    schema: z.object({ tenantId: z.string() }),
    access: { roles: ["User"] },
    handler: async (query, ctx) => {
      const rows = await selectMany(ctx.db, noteTable, {
        tenantId: query.payload.tenantId,
      });
      return rows.map((row) => ({ title: row["title"], tenantId: row["tenantId"] }));
    },
  });

  r.writeHandler({
    name: "retitle-for-tenant",
    schema: z.object({ tenantId: z.string(), title: z.string() }),
    access: { roles: ["User"] },
    handler: async (event, ctx) => {
      const count = await updateRows(
        ctx.db,
        noteTable,
        { tenantId: event.payload.tenantId },
        { title: event.payload.title },
      );
      return { isSuccess: true as const, data: { count } };
    },
  });
});

let stack: TestStack;

const tenantA = testTenantId(81);
const tenantB = testTenantId(82);
const userA = createTestUser({ id: 81, tenantId: tenantA, roles: ["User"] });
const userB = createTestUser({ id: 82, tenantId: tenantB, roles: ["User"] });

beforeAll(async () => {
  stack = await setupTestStack({ features: [probeFeature] });
  await unsafeCreateEntityTable(stack.db, noteEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("tenant-db WHERE merge — full stack", () => {
  test("foreign where.tenantId in a query never returns the other tenant's rows", async () => {
    await stack.http.writeOk("where-merge-probe:write:note:create", { title: "a-note" }, userA);
    await stack.http.writeOk("where-merge-probe:write:note:create", { title: "b-note" }, userB);

    // userA EXPLICITLY requests tenantB — the merge IGNORES the foreign
    // tenantId (falls back to the user's own scope): b-note is never
    // returned, so the foreign row remains invisible.
    const crossRead = (await stack.http.queryOk(
      "where-merge-probe:query:list-for-tenant",
      { tenantId: tenantB },
      userA,
    )) as Array<{ title: string; tenantId: string }>;
    expect(crossRead.map((r) => r.title)).not.toContain("b-note");
    expect(crossRead.every((r) => r.tenantId === tenantA)).toBe(true);

    // Control: the user's own tenant remains readable through the same path.
    const ownRead = (await stack.http.queryOk(
      "where-merge-probe:query:list-for-tenant",
      { tenantId: tenantA },
      userA,
    )) as Array<{ title: string }>;
    expect(ownRead.map((r) => r.title)).toEqual(["a-note"]);
  });

  test("foreign where.tenantId in an update never touches the other tenant's rows", async () => {
    await stack.http.writeOk(
      "where-merge-probe:write:retitle-for-tenant",
      { tenantId: tenantB, title: "HACKED" },
      userA,
    );

    const bRows = (await stack.http.queryOk(
      "where-merge-probe:query:list-for-tenant",
      { tenantId: tenantB },
      userB,
    )) as Array<{ title: string }>;
    expect(bRows.map((r) => r.title)).toEqual(["b-note"]);
  });
});

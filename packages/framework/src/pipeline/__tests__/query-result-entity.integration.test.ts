// A custom query handler that does not follow the entity:verb naming declares resultEntity to get
// the entity's field read rules and writeOnly mask applied to its result. Real HTTP + setupTestStack.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { resetEventStore, setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { selectMany } from "../../db/query.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import { createEntity, createTextField, defineFeature } from "../../engine/index.ts";
import type { SessionUser } from "../../engine/types/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const admin = TestUsers.admin;
const member = TestUsers.user;
const SECRET = "tok-live-0001";

const noteEntity = createEntity({
  name: "note",
  table: "qre_notes",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    internalNote: createTextField({
      personal: false,
      reason: "test_fixture",
      access: { read: ["Admin"], write: ["Admin"] },
    }),
    token: createTextField({ personal: "tenant", find: "secret", writeOnly: true }),
  },
});
const noteTable = buildEntityTable(noteEntity);

const feature = defineFeature("qre", (r) => {
  r.crud(noteEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin", "User"] } },
  });
  r.queryHandler({
    name: "notes-overview",
    schema: z.object({}),
    resultEntity: "note",
    access: { roles: ["Admin", "User"] },
    handler: async (_query, ctx) => ({ rows: await selectMany(ctx.db, noteTable, {}) }),
  });
});

type OverviewRow = Record<string, unknown>;

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack, ["qre_notes"]);
});

async function overviewAs(user: SessionUser): Promise<OverviewRow[]> {
  const result = await stack.http.queryOk<{ rows: OverviewRow[] }>(
    "qre:query:notes-overview",
    {},
    user,
  );
  return result.rows;
}

describe("query resultEntity", () => {
  test("a non-admin gets no internalNote and a masked token", async () => {
    await stack.http.writeOk(
      "qre:write:note:create",
      { title: "t", internalNote: "only for admins", token: SECRET },
      admin,
    );

    const [row] = await overviewAs(member);

    expect(row?.["title"]).toBe("t");
    expect(row).not.toHaveProperty("internalNote");
    expect(row?.["token"]).toBe(true);
    expect(JSON.stringify(row)).not.toContain(SECRET);
  });

  test("an admin sees internalNote, the token stays masked", async () => {
    await stack.http.writeOk(
      "qre:write:note:create",
      { title: "t", internalNote: "only for admins", token: SECRET },
      admin,
    );

    const [row] = await overviewAs(admin);

    expect(row?.["internalNote"]).toBe("only for admins");
    expect(row?.["token"]).toBe(true);
  });
});

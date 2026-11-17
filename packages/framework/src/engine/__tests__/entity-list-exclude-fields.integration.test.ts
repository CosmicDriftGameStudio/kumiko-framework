// `excludeFields` on entity-list: the SQL never reads the excluded columns, every other
// column stays, and the cursor still works.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import {
  createEntity,
  createLongTextField,
  createMoneyField,
  createTextField,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineFeature,
} from "../index.ts";

const noteEntity = createEntity({
  table: "read_list_exclude_notes",
  fields: {
    title: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      sortable: true,
    }),
    body: createLongTextField({ personal: false, reason: "test_fixture" }),
    price: createMoneyField(),
  },
});

const noteTable = buildEntityTable("brief-note", noteEntity);
const LIST = "listexclude:query:brief-note:list";
const DETAIL = "listexclude:query:brief-note:detail";
const NOTE_BODY = "long text ".repeat(50);

const listExcludeFeature = defineFeature("listexclude", (r) => {
  r.entity({ name: "brief-note", ...noteEntity });

  const noteExecutor = createEventStoreExecutor(noteTable, noteEntity, {
    entityName: "brief-note",
  });

  r.writeHandler({
    name: "brief-note:create",
    schema: z.object({
      title: z.string(),
      body: z.string(),
      price: z.object({ amount: z.number(), currency: z.string() }),
    }),
    handler: async (event, ctx) => noteExecutor.create(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });

  r.queryHandler(
    defineEntityListHandler("brief-note", noteEntity, {
      access: { roles: ["Admin"] },
      excludeFields: ["body"],
    }),
  );
  r.queryHandler(
    defineEntityDetailHandler("brief-note", noteEntity, { access: { roles: ["Admin"] } }),
  );
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [listExcludeFeature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, noteEntity, "brief-note");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack, ["read_list_exclude_notes"]);
});

async function createNote(title: string, amount: number): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "listexclude:write:brief-note:create",
    { title, body: NOTE_BODY, price: { amount, currency: "EUR" } },
    admin,
  );
  return created.id;
}

type ListedRow = Record<string, unknown> & { id: string };
type ListPage = { rows: ListedRow[]; nextCursor: string | null };

describe("entity-list excludeFields", () => {
  test("the list leaves out the excluded field and keeps every other column", async () => {
    const id = await createNote("a", 100);

    const page = await stack.http.queryOk<ListPage>(LIST, { sort: "title" }, admin);
    const detail = await stack.http.queryOk<Record<string, unknown>>(DETAIL, { id }, admin);

    const row = page.rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row).not.toHaveProperty("body");
    expect(Object.keys(row).sort()).toEqual(
      Object.keys(detail)
        .filter((key) => key !== "body")
        .sort(),
    );
    expect(row["price"]).toEqual(detail["price"]);
    expect(detail["body"]).toBe(NOTE_BODY);
  });

  test("a fields selection naming the excluded field fails", async () => {
    const error = await stack.http.queryErr(LIST, { fields: ["body"] }, admin);
    expect(error.httpStatus).toBe(400);
  });

  test("paging with a cursor still works", async () => {
    await createNote("a", 1);
    const idB = await createNote("b", 2);
    await createNote("c", 3);

    const first = await stack.http.queryOk<ListPage>(LIST, { sort: "title", limit: 1 }, admin);
    expect(first.nextCursor).not.toBeNull();

    const second = await stack.http.queryOk<ListPage>(
      LIST,
      { sort: "title", limit: 1, cursor: first.nextCursor },
      admin,
    );
    expect(second.rows[0]?.id).toBe(idB);
    expect(second.rows[0]).not.toHaveProperty("body");
  });

  test("an unknown excluded field fails at definition", () => {
    expect(() =>
      defineEntityListHandler("brief-note", noteEntity, {
        access: { roles: ["Admin"] },
        excludeFields: ["nope"],
      }),
    ).toThrow(/excludeFields names unknown field "nope"/);
  });
});

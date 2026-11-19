// `fields` on entity-list: the SQL reads only id, version and the named fields,
// and the cursor still works when the sort column is not part of the selection.
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
  defineEntityListHandler,
  defineFeature,
} from "../index.ts";

const noteEntity = createEntity({
  name: "list-note",
  table: "read_list_fields_notes",
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

const noteTable = buildEntityTable(noteEntity);
const LIST = "listfields:query:list-note:list";

const listFieldsFeature = defineFeature("listfields", (r) => {
  r.entity(noteEntity);

  const noteExecutor = createEventStoreExecutor(noteTable, noteEntity, {
    entityName: "list-note",
  });

  r.writeHandler({
    name: "list-note:create",
    schema: z.object({
      title: z.string(),
      body: z.string(),
      price: z.object({ amount: z.number(), currency: z.string() }),
    }),
    handler: async (event, ctx) => noteExecutor.create(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });

  r.queryHandler(
    defineEntityListHandler("list-note", noteEntity, { access: { roles: ["Admin"] } }),
  );
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [listFieldsFeature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, noteEntity, "list-note");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack, ["read_list_fields_notes"]);
});

async function createNote(title: string, amount: number): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    "listfields:write:list-note:create",
    { title, body: "long text ".repeat(50), price: { amount, currency: "EUR" } },
    admin,
  );
  return created.id;
}

type ListedRow = Record<string, unknown> & { id: string };
type ListPage = { rows: ListedRow[]; nextCursor: string | null };

describe("entity-list fields", () => {
  test("returns only id, version and the requested fields", async () => {
    await createNote("a", 100);
    await createNote("b", 200);

    const full = await stack.http.queryOk<ListPage>(LIST, { sort: "title" }, admin);
    const narrow = await stack.http.queryOk<ListPage>(
      LIST,
      { fields: ["title", "price"], sort: "title" },
      admin,
    );

    expect(full.rows[0]).toHaveProperty("body");
    expect(narrow.rows).toHaveLength(2);
    for (const [index, row] of narrow.rows.entries()) {
      expect(Object.keys(row).sort()).toEqual(["id", "price", "title", "version"]);
      expect(row["price"]).toEqual(full.rows[index]?.["price"]);
    }
  });

  test("pages with a cursor while reading only the requested fields", async () => {
    await createNote("a", 1);
    const idB = await createNote("b", 2);
    await createNote("c", 3);

    const sorted = await stack.http.queryOk<ListPage>(LIST, { sort: "title" }, admin);
    expect(sorted.rows[1]?.id).toBe(idB);

    const first = await stack.http.queryOk<ListPage>(
      LIST,
      { fields: ["price"], sort: "title", limit: 1 },
      admin,
    );
    expect(first.nextCursor).not.toBeNull();

    const second = await stack.http.queryOk<ListPage>(
      LIST,
      { fields: ["price"], sort: "title", limit: 1, cursor: first.nextCursor },
      admin,
    );
    expect(second.rows[0]?.id).toBe(idB);
  });

  test("rejects a name that is no stored field", async () => {
    const error = await stack.http.queryErr(LIST, { fields: ["nope"] }, admin);
    expect(error.httpStatus).toBe(400);
  });
});

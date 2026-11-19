// A dispatchOnly query closes the client entry only; its access rule still grants the row gates,
// so rows hanging on the entity follow the roles of that rule.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import {
  defineEntityQueryHandler,
  defineEntityWriteHandler,
} from "../../engine/entity-handlers.ts";
import { createEntity, createTextField, defineFeature } from "../../engine/index.ts";
import { createTestUser } from "../../seeding/seed-users.ts";

const USER_ACCESS = { roles: ["User"] };
// A Clerk may list notes but holds no role of any vault query.
const NOTE_READER_ACCESS = { roles: ["User", "Clerk"] };

const vaultEntity = createEntity({
  name: "vault",
  table: "do_read_vaults",
  fields: { name: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});

const noteEntity = createEntity({
  name: "note",
  table: "do_read_notes",
  parentRef: { entityTypeField: "entityType", entityIdField: "entityId", allowedTypes: ["vault"] },
  fields: {
    entityType: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    entityId: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    label: createTextField({ required: true, personal: false, reason: "test_fixture" }),
  },
});

const VAULT_LIST = "doread:query:vault:list";
const NOTE_LIST = "doread:query:note:list";

type Page = { readonly rows: readonly Record<string, unknown>[] };

const feature = defineFeature("doread", (r) => {
  r.entity(vaultEntity);
  r.entity(noteEntity);
  r.writeHandler(defineEntityWriteHandler("vault:create", vaultEntity, { access: USER_ACCESS }));
  r.writeHandler(defineEntityWriteHandler("note:create", noteEntity, { access: USER_ACCESS }));
  r.queryHandler({
    ...defineEntityQueryHandler("vault:list", vaultEntity, { access: USER_ACCESS }),
    dispatchOnly: true,
  });
  r.queryHandler(defineEntityQueryHandler("note:list", noteEntity, { access: NOTE_READER_ACCESS }));
  r.queryHandler({
    name: "vault-overview",
    schema: z.object({}),
    access: USER_ACCESS,
    handler: async (_query, ctx) => ctx.dispatch.query(VAULT_LIST, {}),
  });
  r.queryHandler({
    name: "note-overview",
    schema: z.object({}),
    access: USER_ACCESS,
    handler: async (_query, ctx) => ctx.dispatch.query(NOTE_LIST, {}),
  });
});

const user = createTestUser({ id: 2, roles: ["User"] });
const clerk = createTestUser({ id: 3, roles: ["Clerk"] });
let stack: TestStack;
let vaultId: string;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  await unsafeCreateEntityTable(stack.db, vaultEntity);
  await unsafeCreateEntityTable(stack.db, noteEntity);
  const vault = await stack.http.writeOk("doread:write:vault:create", { name: "main" }, user);
  vaultId = String(vault["id"]);
  await stack.http.writeOk(
    "doread:write:note:create",
    { entityType: "vault", entityId: vaultId, label: "on-main" },
    user,
  );
});

afterAll(async () => {
  await stack.cleanup();
});

describe("dispatchOnly host query and server-side reads", () => {
  test("the client entry answers 404", async () => {
    const error = await stack.http.queryErr(VAULT_LIST, {}, user);
    expect(error.httpStatus).toBe(404);
  });

  test("a handler dispatching the dispatchOnly list returns its rows", async () => {
    const page = await stack.http.queryOk<Page>("doread:query:vault-overview", {}, user);
    expect(page.rows.map((row) => row["id"])).toEqual([vaultId]);
  });

  test("rows whose parent is the dispatchOnly entity stay readable through a dispatched list", async () => {
    const page = await stack.http.queryOk<Page>("doread:query:note-overview", {}, user);
    expect(page.rows.map((row) => row["label"])).toEqual(["on-main"]);
  });

  test("a user without the dispatchOnly query's role does not get the child row", async () => {
    const page = await stack.http.queryOk<Page>(NOTE_LIST, {}, clerk);
    expect(page.rows).toEqual([]);
  });
});

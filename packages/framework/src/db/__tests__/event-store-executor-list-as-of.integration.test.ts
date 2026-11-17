// listAsOf with an aggregate id filter and erased subject keys, driven through real handlers
// over HTTP.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { InMemoryKmsAdapter, PII_ERASED_SENTINEL } from "../../crypto/index.ts";
import { createEntity, createTextField, defineFeature } from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { createEventStoreExecutor } from "../event-store-executor.ts";
import { buildEntityTable } from "../table-builder.ts";

const kms = new InMemoryKmsAdapter();

const draftEntity = createEntity({
  name: "draft",
  table: "read_asof_drafts",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    body: createTextField({ personal: { of: "authorId", whenAbsent: "tenant" }, find: "none" }),
    authorId: createTextField({ personal: false, reason: "test_fixture" }),
  },
});
const draftTable = buildEntityTable(draftEntity);

const asOfFeature = defineFeature("asof", (r) => {
  r.entity(draftEntity);
  const exec = createEventStoreExecutor(draftTable, draftEntity, { entityName: "draft", kms });
  const idPayload = z.object({ id: z.uuid() });
  const access = { roles: ["Admin", "User"] };

  r.writeHandler({
    name: "draft:create",
    schema: z.object({ title: z.string(), body: z.string(), authorId: z.string() }),
    handler: async (event, ctx) => exec.create(event.payload, event.user, ctx.db),
    access,
  });
  r.writeHandler({
    name: "draft:delete",
    schema: idPayload,
    handler: async (event, ctx) => exec.delete({ id: event.payload.id }, event.user, ctx.db),
    agent: { risk: "high" },
    access,
  });
  r.queryHandler({
    name: "draft:events",
    schema: idPayload,
    handler: async (query, ctx) => ctx.events.load(query.payload.id),
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
  r.queryHandler({
    name: "draft:history",
    schema: idPayload,
    handler: async (query, ctx) => exec.history({ id: query.payload.id }, query.user, ctx.db),
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
  r.queryHandler({
    name: "draft:as-of",
    schema: z.object({ asOf: z.iso.datetime(), ids: z.array(z.uuid()).optional() }),
    handler: async (query, ctx) =>
      exec.listAsOf(
        { asOf: Temporal.Instant.from(query.payload.asOf), ids: query.payload.ids },
        query.user,
        ctx.db,
      ),
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
});

type StoredEventView = { readonly type: string; readonly createdAt: string };
type HistoryEntryView = { readonly at: string; readonly verb: string };
type AsOfRow = { readonly id: string; readonly title: string; readonly body: string };

const admin = TestUsers.admin;
const AUTHOR_FILTER = "00000000-0000-4000-8000-0000000000a1";
const AUTHOR_EMPTY = "00000000-0000-4000-8000-0000000000a2";
const AUTHOR_ALL = "00000000-0000-4000-8000-0000000000a3";
const AUTHOR_DELETED = "00000000-0000-4000-8000-0000000000a4";
const AUTHOR_ERASED = "00000000-0000-4000-8000-0000000000a5";
const AUTHOR_KEPT = "00000000-0000-4000-8000-0000000000a6";
const AUTHOR_ERASED_OTHER = "00000000-0000-4000-8000-0000000000a7";
let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [asOfFeature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, draftEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack, ["read_asof_drafts"]);
});

async function createDraft(title: string, authorId: string, body = `${title} body`) {
  const { id } = await stack.http.writeOk<{ id: string }>(
    "asof:write:draft:create",
    { title, body, authorId },
    admin,
  );
  return id;
}

async function createdAt(id: string): Promise<string> {
  const history = await stack.http.queryOk<HistoryEntryView[] | null>(
    "asof:query:draft:history",
    { id },
    admin,
  );
  const entry = history?.find((candidate) => candidate.verb === "created");
  if (entry === undefined) throw new Error(`created entry of ${id} missing`);
  return entry.at;
}

function draftsAsOf(asOf: string, ids?: readonly string[]): Promise<AsOfRow[]> {
  return stack.http.queryOk<AsOfRow[]>("asof:query:draft:as-of", { asOf, ids }, admin);
}

describe("executor listAsOf ids filter", () => {
  test("ids limits the rows to the named aggregates", async () => {
    const a = await createDraft("A", AUTHOR_FILTER);
    await createDraft("B", AUTHOR_FILTER);
    const c = await createDraft("C", AUTHOR_FILTER);

    const rows = await draftsAsOf(await createdAt(c), [a, c]);

    expect(rows.map((row) => row.id).sort()).toEqual([a, c].sort());
    expect(rows.find((row) => row.id === a)?.title).toBe("A");
  });

  test("an empty ids list returns no rows", async () => {
    const id = await createDraft("A", AUTHOR_EMPTY);

    expect(await draftsAsOf(await createdAt(id), [])).toEqual([]);
  });

  test("without ids every row of the tenant comes back", async () => {
    const a = await createDraft("A", AUTHOR_ALL);
    const b = await createDraft("B", AUTHOR_ALL);

    const rows = await draftsAsOf(await createdAt(b));

    expect(rows.map((row) => row.id).sort()).toEqual([a, b].sort());
  });

  test("an id deleted before asOf is absent although it is named", async () => {
    const a = await createDraft("A", AUTHOR_DELETED);
    const b = await createDraft("B", AUTHOR_DELETED);
    await stack.http.writeOk("asof:write:draft:delete", { id: b }, admin);
    const events = await stack.http.queryOk<StoredEventView[]>(
      "asof:query:draft:events",
      { id: b },
      admin,
    );
    const deleted = events.find((event) => event.type === "draft.deleted");
    if (deleted === undefined) throw new Error("expected a deleted event");

    const rows = await draftsAsOf(deleted.createdAt, [a, b]);

    expect(rows.map((row) => row.id)).toEqual([a]);
  });
});

describe("executor listAsOf erased subject keys", () => {
  test("an erased author reads as the erased sentinel", async () => {
    const id = await createDraft("Plan", AUTHOR_ERASED, "first draft");
    const asOf = await createdAt(id);

    const before = await draftsAsOf(asOf, [id]);
    expect(before[0]?.body).toBe("first draft");

    await kms.eraseKey({ kind: "user", userId: AUTHOR_ERASED });

    const after = await draftsAsOf(asOf, [id]);
    expect(after[0]?.body).toBe(PII_ERASED_SENTINEL);
    expect(after[0]?.title).toBe("Plan");
  });

  test("erasing one author leaves another author's rows readable", async () => {
    const erased = await createDraft("Erased", AUTHOR_ERASED_OTHER, "gone");
    const kept = await createDraft("Kept", AUTHOR_KEPT, "still here");
    const asOf = await createdAt(kept);

    await kms.eraseKey({ kind: "user", userId: AUTHOR_ERASED_OTHER });

    const rows = await draftsAsOf(asOf, [erased, kept]);
    expect(rows.find((row) => row.id === erased)?.body).toBe(PII_ERASED_SENTINEL);
    expect(rows.find((row) => row.id === kept)?.body).toBe("still here");
  });
});

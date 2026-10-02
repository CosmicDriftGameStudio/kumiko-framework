// A writeOnly secret field is never returned: reads (detail, list), write
// responses and batch responses carry `true` (set) / `null` (empty). Writes:
// "" / omitted = unchanged, null = clear, string = new value, true = rejected.
// Real HTTP + setupTestStack. The plaintext must not appear anywhere in any
// response body, and server code (the executor) must still see it.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor.js";
import { buildEntityTable } from "../../db/table-builder.js";
import { createEntity, createTextField, defineFeature } from "../../engine/index.js";
import { resetEventStore, setupTestStack, type TestStack, TestUsers } from "../../stack/index.js";

const admin = TestUsers.admin;
const PLAINTEXT = "sk-live-super-secret-0001";
const NEXT_PLAINTEXT = "sk-live-super-secret-0002";

const connectionEntity = createEntity({
  table: "wo_connections",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture", required: true }),
    apiKey: createTextField({ personal: "tenant", find: "secret", writeOnly: true }),
    requiredKey: createTextField({
      personal: "tenant",
      find: "secret",
      writeOnly: true,
      required: true,
    }),
    vaultId: createTextField({ personal: false, reason: "test_fixture" }),
  },
});

const linkEntity = createEntity({
  table: "wo_links",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture", required: true }),
    connection: { type: "reference", entity: "connection" },
  },
});

const vaultEntity = createEntity({
  table: "wo_vaults",
  fields: {
    name: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});

const connectionExecutor = createEventStoreExecutor(
  buildEntityTable("connection", connectionEntity),
  connectionEntity,
  { entityName: "connection" },
);

// What server code sees: postSave hooks and handlers keep the plaintext.
const hookSawApiKeys: unknown[] = [];

const feature = defineFeature("wo", (r) => {
  const connection = r.entity("connection", connectionEntity);
  r.hook("postSave", { allOf: connection }, async (result) => {
    hookSawApiKeys.push(result.data["apiKey"]);
  });
  // Returns only a boolean so the secret itself never leaves the server.
  r.queryHandler(
    "stored-key-matches",
    z.object({ id: z.uuid(), candidate: z.string() }),
    async (query, ctx) => {
      const row = await connectionExecutor.detail({ id: query.payload.id }, query.user, ctx.db);
      return { matches: row?.["apiKey"] === query.payload.candidate };
    },
    { access: { roles: ["Admin"] } },
  );
  r.crud("connection", connectionEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin"] } },
  });
  r.entity("link", linkEntity);
  r.crud("link", linkEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin"] } },
  });
  r.entity("vault", vaultEntity);
  r.relation("vault", "connections", {
    type: "hasMany",
    target: "connection",
    foreignKey: "vaultId",
    nestedWrite: true,
  });
  r.crud("vault", vaultEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin"] } },
  });
});

const CREATE = "wo:write:connection:create";
const UPDATE = "wo:write:connection:update";
const DETAIL = "wo:query:connection:detail";
const LIST = "wo:query:connection:list";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  hookSawApiKeys.length = 0;
  await resetEventStore(stack, ["wo_connections", "wo_links", "wo_vaults"]);
});

async function createConnection(extra: Record<string, unknown> = {}): Promise<string> {
  const { id } = await stack.http.writeOk<{ id: string }>(
    CREATE,
    { label: "c", requiredKey: "req-key-1", ...extra },
    admin,
  );
  return id;
}

function savedRow(saveResult: Record<string, unknown>): Record<string, unknown> {
  return saveResult["data"] as Record<string, unknown>;
}

async function storedKeyMatches(id: string, candidate: string): Promise<boolean> {
  const { matches } = await stack.http.queryOk<{ matches: boolean }>(
    "wo:query:stored-key-matches",
    { id, candidate },
    admin,
  );
  return matches;
}

async function detail(id: string): Promise<Record<string, unknown>> {
  return stack.http.queryOk<Record<string, unknown>>(DETAIL, { id }, admin);
}

async function updateChanges(
  id: string,
  changes: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const row = await detail(id);
  return stack.http.writeOk<Record<string, unknown>>(
    UPDATE,
    { id, version: row["version"], changes },
    admin,
  );
}

describe("writeOnly entity field", () => {
  test("create response, detail and list return true, never the plaintext", async () => {
    const created = await stack.http.writeOk<Record<string, unknown>>(
      CREATE,
      { label: "c", apiKey: PLAINTEXT, requiredKey: "req-key-1" },
      admin,
    );
    expect(savedRow(created)["apiKey"]).toBe(true);
    expect(JSON.stringify(created)).not.toContain(PLAINTEXT);
    const id = created["id"] as string;
    expect(JSON.stringify(created["changes"])).toContain('"apiKey":true');

    const row = await detail(id);
    expect(row["apiKey"]).toBe(true);
    expect(row["requiredKey"]).toBe(true);
    expect(JSON.stringify(row)).not.toContain(PLAINTEXT);

    const list = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      LIST,
      { limit: 10 },
      admin,
    );
    expect(list.rows[0]?.["apiKey"]).toBe(true);
    expect(JSON.stringify(list)).not.toContain(PLAINTEXT);
  });

  test("an unset field reads back null", async () => {
    const id = await createConnection();
    expect((await detail(id))["apiKey"]).toBeNull();
  });

  test('update with "" leaves the stored secret unchanged', async () => {
    const id = await createConnection({ apiKey: PLAINTEXT });
    const response = await updateChanges(id, { label: "renamed", apiKey: "" });
    expect(savedRow(response)["apiKey"]).toBe(true);
    expect((await detail(id))["apiKey"]).toBe(true);
    expect(await storedKeyMatches(id, PLAINTEXT)).toBe(true);
  });

  test("update with a string replaces the secret and the response stays masked", async () => {
    const id = await createConnection({ apiKey: PLAINTEXT });
    const response = await updateChanges(id, { apiKey: NEXT_PLAINTEXT });
    expect(savedRow(response)["apiKey"]).toBe(true);
    expect(JSON.stringify(response)).not.toContain(NEXT_PLAINTEXT);
    expect(JSON.stringify(response)).not.toContain(PLAINTEXT);
    expect(JSON.stringify(await detail(id))).not.toContain(NEXT_PLAINTEXT);
    expect(await storedKeyMatches(id, NEXT_PLAINTEXT)).toBe(true);
    expect(await storedKeyMatches(id, PLAINTEXT)).toBe(false);
  });

  test("update with null clears an optional field", async () => {
    const id = await createConnection({ apiKey: PLAINTEXT });
    const response = await updateChanges(id, { apiKey: null });
    expect(savedRow(response)["apiKey"]).toBeNull();
    expect((await detail(id))["apiKey"]).toBeNull();
    expect(await storedKeyMatches(id, PLAINTEXT)).toBe(false);
  });

  test("postSave hooks see the plaintext while the client response is masked", async () => {
    const created = await stack.http.writeOk<Record<string, unknown>>(
      CREATE,
      { label: "h", requiredKey: "k", apiKey: PLAINTEXT },
      admin,
    );
    expect(hookSawApiKeys).toContain(PLAINTEXT);
    expect(savedRow(created)["apiKey"]).toBe(true);
  });

  test("update with null on a required field is a validation error", async () => {
    const id = await createConnection();
    const row = await detail(id);
    const error = await stack.http.writeErr(
      UPDATE,
      { id, version: row["version"], changes: { requiredKey: null } },
      admin,
    );
    expect(error.httpStatus).toBe(400);
    expect((await detail(id))["requiredKey"]).toBe(true);
  });

  test("true in the payload fails loudly and changes nothing", async () => {
    const id = await createConnection({ apiKey: PLAINTEXT });
    const row = await detail(id);
    const error = await stack.http.writeErr(
      UPDATE,
      { id, version: row["version"], changes: { apiKey: true } },
      admin,
    );
    expect(error.httpStatus).toBe(400);
    expect((await detail(id))["apiKey"]).toBe(true);

    const createError = await stack.http.writeErr(
      CREATE,
      { label: "c", requiredKey: "k", apiKey: true },
      admin,
    );
    expect(createError.httpStatus).toBe(400);
  });

  test("eager-loaded _refs carry true for a writeOnly field of the referenced row", async () => {
    const connectionId = await createConnection({ apiKey: PLAINTEXT });
    const { id: linkId } = await stack.http.writeOk<{ id: string }>(
      "wo:write:link:create",
      { label: "l", connection: connectionId },
      admin,
    );

    const list = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      "wo:query:link:list",
      { limit: 10 },
      admin,
    );
    const refs = list.rows[0]?.["_refs"] as Record<string, Record<string, unknown>>;
    expect(refs["connection"]?.["id"]).toBe(connectionId);
    expect(refs["connection"]?.["apiKey"]).toBe(true);
    expect(JSON.stringify(list)).not.toContain(PLAINTEXT);

    const linkDetail = await stack.http.queryOk<Record<string, unknown>>(
      "wo:query:link:detail",
      { id: linkId },
      admin,
    );
    expect(JSON.stringify(linkDetail)).not.toContain(PLAINTEXT);
    expect(JSON.stringify(linkDetail)).toContain('"apiKey":true');
  });

  test("nested children in a write result are masked", async () => {
    const created = await stack.http.writeOk<Record<string, unknown>>(
      "wo:write:vault:create",
      {
        name: "v",
        connections: [{ label: "c", requiredKey: "req-key-1", apiKey: PLAINTEXT }],
      },
      admin,
    );
    const children = savedRow(created)["connections"] as Record<string, unknown>[];
    expect(children).toHaveLength(1);
    expect(children[0]?.["apiKey"]).toBe(true);
    expect(children[0]?.["requiredKey"]).toBe(true);
    expect(JSON.stringify(created)).not.toContain(PLAINTEXT);
  });

  test("batch responses are masked too", async () => {
    const res = await stack.http.batch(
      [{ type: CREATE, payload: { label: "b", requiredKey: "k", apiKey: PLAINTEXT } }],
      admin,
    );
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).not.toContain(PLAINTEXT);
    expect(body).toContain('"apiKey":true');
  });
});

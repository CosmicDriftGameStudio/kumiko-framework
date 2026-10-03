// jsonb field with `personal`: ciphertext (a JSON string scalar) in the read
// row and the event payload; objects come back through list/detail, existing
// plaintext stays readable, tenant key erase yields the sentinel.
// Real HTTP + setupTestStack; the DB is only read for the raw-storage asserts.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
import { asRawClient } from "../../db/query.js";
import {
  createEntity,
  createJsonbField,
  createTextField,
  defineFeature,
} from "../../engine/index.js";
import { rebuildProjection } from "../../pipeline/index.js";
import { resetEventStore, setupTestStack, type TestStack, TestUsers } from "../../stack/index.js";
import { InMemoryKmsAdapter } from "../in-memory-kms-adapter.js";
import {
  configurePiiSubjectKms,
  PII_CIPHERTEXT_PREFIX_JSON,
  PII_ERASED_SENTINEL,
} from "../pii-field-encryption.js";

const admin = TestUsers.admin;

const goldenEntity = createEntity({
  table: "pii_jsonb_goldens",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture", required: true }),
    input: createJsonbField({ personal: "tenant" }),
  },
});

const feature = defineFeature("jsonbpii", (r) => {
  r.entity("golden", goldenEntity);
  r.crud("golden", goldenEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin"] } },
  });
});

const CREATE = "jsonbpii:write:golden:create";
const UPDATE = "jsonbpii:write:golden:update";
const DETAIL = "jsonbpii:query:golden:detail";
const LIST = "jsonbpii:query:golden:list";
const PROJECTION = "jsonbpii:projection:golden-entity";
const PAYLOAD = { question: "what is 2+2?", nested: { answers: [4, "four"], ok: true } };

let stack: TestStack;
let kms: InMemoryKmsAdapter;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
});

afterEach(async () => {
  resetPiiSubjectKmsForTests();
  await resetEventStore(stack, ["pii_jsonb_goldens"]);
});

async function create(input: Record<string, unknown>): Promise<string> {
  const { id } = await stack.http.writeOk<{ id: string }>(CREATE, { label: "g", input }, admin);
  return id;
}

async function detail(id: string): Promise<Record<string, unknown>> {
  return stack.http.queryOk<Record<string, unknown>>(DETAIL, { id }, admin);
}

async function list(): Promise<Record<string, unknown>[]> {
  const res = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
    LIST,
    { limit: 10 },
    admin,
  );
  return res.rows;
}

async function rawColumn(id: string): Promise<{ kind: string; text: string }> {
  const rows = await asRawClient(stack.db).unsafe<{ kind: string; text: string }>(
    `SELECT jsonb_typeof(input) AS kind, input #>> '{}' AS text FROM pii_jsonb_goldens WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error(`no row ${id}`);
  return row;
}

async function rawEventInput(id: string): Promise<readonly { kind: string; text: string }[]> {
  return asRawClient(stack.db).unsafe<{ kind: string; text: string }>(
    `SELECT jsonb_typeof(payload->'input') AS kind, payload->'input' #>> '{}' AS text
     FROM kumiko_events WHERE aggregate_id = $1 ORDER BY version`,
    [id],
  );
}

describe("jsonb PII field", () => {
  test("row and event hold a ciphertext JSON string; detail and list return the object", async () => {
    const id = await create(PAYLOAD);

    const column = await rawColumn(id);
    expect(column.kind).toBe("string");
    expect(column.text).toStartWith(`${PII_CIPHERTEXT_PREFIX_JSON}tenant:${admin.tenantId}:`);
    expect(column.text).not.toContain("what is 2+2");

    const events = await rawEventInput(id);
    expect(events[0]?.kind).toBe("string");
    expect(events[0]?.text).toStartWith(PII_CIPHERTEXT_PREFIX_JSON);

    expect((await detail(id))["input"]).toEqual(PAYLOAD);
    expect((await list())[0]?.["input"]).toEqual(PAYLOAD);
  });

  test("update re-encrypts the new object", async () => {
    const id = await create(PAYLOAD);
    const row = await detail(id);
    const next = { replaced: [1, 2, 3] };
    await stack.http.writeOk(
      UPDATE,
      { id, version: row["version"], changes: { input: next } },
      admin,
    );
    expect((await rawColumn(id)).kind).toBe("string");
    expect((await detail(id))["input"]).toEqual(next);
  });

  test("projection rebuild keeps the ciphertext column readable", async () => {
    const id = await create(PAYLOAD);
    await rebuildProjection(PROJECTION, { db: stack.db, registry: stack.registry });

    const column = await rawColumn(id);
    expect(column.kind).toBe("string");
    expect(column.text).toStartWith(PII_CIPHERTEXT_PREFIX_JSON);
    expect((await detail(id))["input"]).toEqual(PAYLOAD);
  });

  test("erased tenant key: list and detail return the sentinel without an error", async () => {
    const id = await create(PAYLOAD);
    await kms.eraseKey({ kind: "tenant", tenantId: admin.tenantId });

    expect((await detail(id))["input"]).toBe(PII_ERASED_SENTINEL);
    expect((await list())[0]?.["input"]).toBe(PII_ERASED_SENTINEL);

    await rebuildProjection(PROJECTION, { db: stack.db, registry: stack.registry });
    expect((await detail(id))["input"]).toBe(PII_ERASED_SENTINEL);
  });

  test("legacy plaintext row and event (written before the KMS was on) stay readable and rebuildable", async () => {
    resetPiiSubjectKmsForTests();
    const id = await create(PAYLOAD);
    expect((await rawColumn(id)).kind).toBe("object");
    expect((await rawEventInput(id))[0]?.kind).toBe("object");

    configurePiiSubjectKms(kms);
    expect((await detail(id))["input"]).toEqual(PAYLOAD);
    expect((await list())[0]?.["input"]).toEqual(PAYLOAD);

    await rebuildProjection(PROJECTION, { db: stack.db, registry: stack.registry });
    expect((await rawColumn(id)).kind).toBe("object");
    expect((await detail(id))["input"]).toEqual(PAYLOAD);

    const row = await detail(id);
    const next = { migrated: true };
    await stack.http.writeOk(
      UPDATE,
      { id, version: row["version"], changes: { input: next } },
      admin,
    );
    expect((await rawColumn(id)).kind).toBe("string");
    expect((await detail(id))["input"]).toEqual(next);
  });
});

// Entity PII field `personal: { of: "ownerId", whenAbsent: "self" }` (fw#3811):
// ownerless rows are encrypted under their own record key instead of the tenant
// key, so a record-forget shreds them. Real HTTP + setupTestStack; the DB is
// only read for the raw-storage asserts.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { resetEventStore, setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { InMemoryKmsAdapter } from "../../crypto/in-memory-kms-adapter.ts";
import {
  configurePiiSubjectKms,
  PII_CIPHERTEXT_PREFIX,
} from "../../crypto/pii-field-encryption.ts";
import { createEntity, createTextField, defineFeature } from "../../engine/index.ts";
import { eventsTable } from "../../event-store/index.ts";
import { rebuildProjection } from "../../pipeline/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { generateId } from "../../utils/index.ts";
import { fetchOne, selectMany } from "../query.ts";
import { buildEntityTable } from "../table-builder.ts";

const admin = TestUsers.admin;
const OWNER = generateId();

const slipEntity = createEntity({
  table: "pii_owner_absent_self_slips",
  fields: {
    ownerId: createTextField({ personal: "ref" }),
    name: createTextField({ personal: { of: "ownerId", whenAbsent: "self" }, find: "none" }),
    note: createTextField({ personal: { of: "ownerId", whenAbsent: "tenant" }, find: "none" }),
  },
});

const slipTable = buildEntityTable("slip", slipEntity);

const feature = defineFeature("ownerabsentself", (r) => {
  r.entity({ name: "slip", ...slipEntity });
  r.crud("slip", slipEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin"] } },
  });
});

const CREATE = "ownerabsentself:write:slip:create";
const UPDATE = "ownerabsentself:write:slip:update";
const DETAIL = "ownerabsentself:query:slip:detail";
const PROJECTION = "ownerabsentself:projection:slip-entity";
const TENANT_PREFIX = `${PII_CIPHERTEXT_PREFIX}tenant:${admin.tenantId}:`;
const USER_PREFIX = `${PII_CIPHERTEXT_PREFIX}user:${OWNER}:`;
const recordPrefix = (id: string): string => `${PII_CIPHERTEXT_PREFIX}record:slip:${id}:`;

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  resetPiiSubjectKmsForTests();
  await resetEventStore(stack, ["pii_owner_absent_self_slips"]);
});

async function createSlip(fields: Record<string, unknown>): Promise<string> {
  const { id } = await stack.http.writeOk<{ id: string }>(CREATE, fields, admin);
  return id;
}

async function detail(id: string): Promise<Record<string, unknown>> {
  return stack.http.queryOk<Record<string, unknown>>(DETAIL, { id }, admin);
}

async function update(id: string, changes: Record<string, unknown>) {
  const row = await detail(id);
  return stack.http.write(UPDATE, { id, version: row["version"], changes }, admin);
}

type EventFields = { name: string | null; note: string | null };

async function eventFields(
  id: string,
  which: "first" | "last",
  section: "payload" | "changes" | "previous",
): Promise<EventFields> {
  const events = (await selectMany(stack.db, eventsTable, { aggregateId: id })) as Array<{
    version: number;
    payload: Record<string, unknown>;
  }>;
  const ordered = events.toSorted((a, b) => a.version - b.version);
  const event = which === "first" ? ordered[0] : ordered[ordered.length - 1];
  if (!event) throw new Error(`no event for ${id}`);
  const fields = section === "payload" ? event.payload : event.payload[section];
  if (typeof fields !== "object" || fields === null) throw new Error(`no ${section} on ${id}`);
  const { name, note } = fields as Record<string, unknown>;
  return {
    name: typeof name === "string" ? name : null,
    note: typeof note === "string" ? note : null,
  };
}

async function projectionColumns(id: string): Promise<Record<string, unknown> | undefined> {
  const row = await fetchOne(stack.db, slipTable, { id });
  return row ? { name: row.name, ownerId: row.ownerId, version: row.version } : undefined;
}

describe("entity PII whenAbsent: self", () => {
  test("ownerless create keys name on the record and note on the tenant; the mixed row decrypts", async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const id = await createSlip({ name: "slip name", note: "slip note" });

    const created = await eventFields(id, "first", "payload");
    expect(created.name).toStartWith(recordPrefix(id));
    expect(created.note).toStartWith(TENANT_PREFIX);

    const row = await detail(id);
    expect(row["name"]).toBe("slip name");
    expect(row["note"]).toBe("slip note");
  });

  test("a created row with an owner is keyed on the user", async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const id = await createSlip({ ownerId: OWNER, name: "owned name" });

    expect((await eventFields(id, "first", "payload")).name).toStartWith(USER_PREFIX);
  });

  test("updating an ownerless row stays record-keyed; rebuild equals live", async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const id = await createSlip({ name: "first name" });

    const res = await update(id, { name: "second name" });
    expect(res.status).toBeLessThan(300);

    expect((await eventFields(id, "last", "changes")).name).toStartWith(recordPrefix(id));
    expect((await eventFields(id, "last", "previous")).name).toStartWith(recordPrefix(id));

    const live = await projectionColumns(id);
    await rebuildProjection(PROJECTION, { db: stack.db, registry: stack.registry });
    expect(await projectionColumns(id)).toEqual(live);
    expect((await detail(id))["name"]).toBe("second name");
  });

  test("owner absent to X: the value moves to the user key, the created event stays record-keyed", async () => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const id = await createSlip({ name: "moving name" });

    const res = await update(id, { ownerId: OWNER });
    expect(res.status).toBeLessThan(300);

    expect((await eventFields(id, "last", "changes")).name).toStartWith(USER_PREFIX);
    expect((await eventFields(id, "first", "payload")).name).toStartWith(recordPrefix(id));
    expect((await detail(id))["name"]).toBe("moving name");
  });
});

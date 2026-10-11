// Entity PII field `personal: { of: "ownerId", whenAbsent: "tenant" }` with a
// nullable owner (fw#3654): rows without an owner stay editable, deletable and
// rebuildable with KMS on, encrypted under the tenant key instead of failing
// with SubjectResolutionError. Real HTTP + setupTestStack; the DB is only read
// for the raw-storage asserts.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
import { InMemoryKmsAdapter } from "../../crypto/in-memory-kms-adapter.js";
import {
  configurePiiSubjectKms,
  PII_CIPHERTEXT_PREFIX,
} from "../../crypto/pii-field-encryption.js";
import { createEntity, createTextField, defineFeature } from "../../engine/index.js";
import { rebuildProjection } from "../../pipeline/index.js";
import { resetEventStore, setupTestStack, type TestStack, TestUsers } from "../../stack/index.js";
import { generateId } from "../../utils/index.js";
import { asRawClient } from "../query.js";

const admin = TestUsers.admin;
const OWNER = generateId();

const itemEntity = createEntity({
  table: "pii_owner_absent_items",
  fields: {
    ownerId: createTextField({ personal: "ref" }),
    name: createTextField({ personal: { of: "ownerId", whenAbsent: "tenant" }, find: "none" }),
  },
});

const feature = defineFeature("ownerabsent", (r) => {
  r.entity("item", itemEntity);
  r.crud("item", itemEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin"] } },
  });
});

const CREATE = "ownerabsent:write:item:create";
const UPDATE = "ownerabsent:write:item:update";
const DELETE = "ownerabsent:write:item:delete";
const DETAIL = "ownerabsent:query:item:detail";
const PROJECTION = "ownerabsent:projection:item-entity";
const TENANT_PREFIX = `${PII_CIPHERTEXT_PREFIX}tenant:${admin.tenantId}:`;
const USER_PREFIX = `${PII_CIPHERTEXT_PREFIX}user:${OWNER}:`;

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  resetPiiSubjectKmsForTests();
  await resetEventStore(stack, ["pii_owner_absent_items"]);
});

function enableKms(): void {
  configurePiiSubjectKms(new InMemoryKmsAdapter());
}

async function createRow(fields: Record<string, unknown>): Promise<string> {
  const { id } = await stack.http.writeOk<{ id: string }>(CREATE, fields, admin);
  return id;
}

// The Klartext-era row from the issue: created before the KMS was on, no owner.
async function seedOwnerlessPlaintextRow(): Promise<string> {
  resetPiiSubjectKmsForTests();
  const id = await createRow({ name: "plain name" });
  enableKms();
  await rebuildProjection(PROJECTION, { db: stack.db, registry: stack.registry });
  return id;
}

async function detail(id: string): Promise<Record<string, unknown>> {
  return stack.http.queryOk<Record<string, unknown>>(DETAIL, { id }, admin);
}

async function update(id: string, changes: Record<string, unknown>) {
  const row = await detail(id);
  return stack.http.write(UPDATE, { id, version: row["version"], changes }, admin);
}

async function lastEventNames(
  id: string,
): Promise<{ changesName: string | null; previousName: string | null }> {
  const rows = await asRawClient(stack.db).unsafe<{
    changes_name: string | null;
    previous_name: string | null;
  }>(
    `SELECT payload->'changes'->>'name' AS changes_name, payload->'previous'->>'name' AS previous_name
     FROM kumiko_events WHERE aggregate_id = $1 ORDER BY version DESC LIMIT 1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error(`no event for ${id}`);
  return { changesName: row.changes_name, previousName: row.previous_name };
}

async function projectionColumns(id: string): Promise<Record<string, unknown>> {
  const rows = await asRawClient(stack.db).unsafe<Record<string, unknown>>(
    `SELECT name, owner_id, version FROM pii_owner_absent_items WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error(`no row ${id}`);
  return row;
}

describe("entity PII whenAbsent: tenant", () => {
  test("update of an ownerless row encrypts under the tenant key; rebuild equals live", async () => {
    const id = await seedOwnerlessPlaintextRow();

    const res = await update(id, { name: "new name" });
    expect(res.status).toBeLessThan(300);

    const events = await lastEventNames(id);
    expect(events.changesName).toStartWith(TENANT_PREFIX);
    expect(events.previousName).toStartWith(TENANT_PREFIX);

    const live = await projectionColumns(id);
    await rebuildProjection(PROJECTION, { db: stack.db, registry: stack.registry });
    expect(await projectionColumns(id)).toEqual(live);
    expect((await detail(id))["name"]).toBe("new name");
  });

  test("delete of an ownerless row encrypts previous under the tenant key", async () => {
    const id = await seedOwnerlessPlaintextRow();
    const row = await detail(id);

    const res = await stack.http.write(DELETE, { id, version: row["version"] }, admin);
    expect(res.status).toBeLessThan(300);

    expect((await lastEventNames(id)).previousName).toStartWith(TENANT_PREFIX);
  });

  test("setting the owner in the same update keeps previous and changes under the user key", async () => {
    const id = await seedOwnerlessPlaintextRow();

    const res = await update(id, { ownerId: OWNER, name: "owned name" });
    expect(res.status).toBeLessThan(300);

    const events = await lastEventNames(id);
    expect(events.changesName).toStartWith(USER_PREFIX);
    expect(events.previousName).toStartWith(USER_PREFIX);
  });

  test("clearing the owner: previous stays under the user key, changes move to the tenant key", async () => {
    enableKms();
    const id = await createRow({ ownerId: OWNER, name: "owned name" });

    const res = await update(id, { ownerId: null, name: "anonymous name" });
    expect(res.status).toBeLessThan(300);

    const events = await lastEventNames(id);
    expect(events.previousName).toStartWith(USER_PREFIX);
    expect(events.changesName).toStartWith(TENANT_PREFIX);
    expect((await detail(id))["name"]).toBe("anonymous name");
  });
});

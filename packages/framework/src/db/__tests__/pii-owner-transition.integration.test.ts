// Personal fields follow the row's current owner: an update that
// moves the owner re-keys the stored value, so only the new owner's forget
// erases it. Real HTTP + setupTestStack; the DB is only read for raw asserts.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  createTestEnvelopeCipher,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-testing/helpers";
import { resetEventStore, setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { InMemoryKmsAdapter } from "../../crypto/in-memory-kms-adapter.ts";
import { subjectIdToKey } from "../../crypto/kms-adapter.ts";
import {
  configurePiiSubjectKms,
  decryptPiiValueForSubject,
  PII_CIPHERTEXT_PREFIX,
  PII_ERASED_SENTINEL,
  piiCiphertextSubject,
} from "../../crypto/pii-field-encryption.ts";
import { createEntity, createTextField, defineFeature } from "../../engine/index.ts";
import { rebuildProjection } from "../../pipeline/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { generateId } from "../../utils/index.ts";
import {
  configureEntityFieldEncryption,
  resetEntityFieldEncryptionCacheForTests,
} from "../entity-field-encryption.ts";
import { backfillEventPiiEncryption } from "../queries/backfill-pii.ts";
import { asRawClient } from "../query.ts";

const admin = TestUsers.admin;

const itemEntity = createEntity({
  table: "pii_owner_transition_items",
  fields: {
    ownerId: createTextField({ personal: "ref" }),
    name: createTextField({ personal: { of: "ownerId", whenAbsent: "tenant" }, find: "none" }),
    note: createTextField({ personal: false, reason: "test_fixture" }),
  },
});

const secretEntity = createEntity({
  table: "pii_owner_transition_secrets",
  fields: {
    ownerId: createTextField({ personal: "ref" }),
    secret: createTextField({
      personal: { of: "ownerId", whenAbsent: "tenant" },
      encrypted: true,
      find: "none",
    }),
  },
});

const feature = defineFeature("ownertransition", (r) => {
  r.entity({ name: "item", ...itemEntity });
  r.crud("item", itemEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin"] } },
  });
  r.entity({ name: "secretitem", ...secretEntity });
  r.crud("secretitem", secretEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { roles: ["Admin"] } },
  });
});

const ITEM = {
  create: "ownertransition:write:item:create",
  update: "ownertransition:write:item:update",
  detail: "ownertransition:query:item:detail",
  projection: "ownertransition:projection:item-entity",
  table: "pii_owner_transition_items",
  column: "name",
  field: "name",
} as const;
const SECRET = {
  create: "ownertransition:write:secretitem:create",
  update: "ownertransition:write:secretitem:update",
  detail: "ownertransition:query:secretitem:detail",
  table: "pii_owner_transition_secrets",
  column: "secret",
  field: "secret",
} as const;

type Target = typeof ITEM | typeof SECRET;

const TENANT_PREFIX = `${PII_CIPHERTEXT_PREFIX}tenant:${admin.tenantId}:`;
const userPrefix = (userId: string): string => `${PII_CIPHERTEXT_PREFIX}user:${userId}:`;

let stack: TestStack;
let kms: InMemoryKmsAdapter;

beforeAll(async () => {
  configureEntityFieldEncryption(createTestEnvelopeCipher());
  stack = await setupTestStack({ features: [feature] });
});

afterAll(async () => {
  await stack.cleanup();
  resetEntityFieldEncryptionCacheForTests();
});

afterEach(async () => {
  resetPiiSubjectKmsForTests();
  await resetEventStore(stack, [ITEM.table, SECRET.table]);
});

function enableKms(): void {
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
}

async function createRow(target: Target, fields: Record<string, unknown>): Promise<string> {
  const { id } = await stack.http.writeOk<{ id: string }>(target.create, fields, admin);
  return id;
}

async function detail(target: Target, id: string): Promise<Record<string, unknown>> {
  return stack.http.queryOk<Record<string, unknown>>(target.detail, { id }, admin);
}

async function update(target: Target, id: string, changes: Record<string, unknown>) {
  const row = await detail(target, id);
  const res = await stack.http.write(
    target.update,
    { id, version: row["version"], changes },
    admin,
  );
  expect(res.status).toBeLessThan(300);
}

interface EventValues {
  readonly changes: Record<string, string | undefined>;
  readonly previous: Record<string, string | undefined>;
}

async function lastUpdatedEvent(id: string): Promise<EventValues> {
  const rows = await asRawClient(stack.db).unsafe<{
    changes: EventValues["changes"];
    previous: EventValues["previous"];
  }>(
    `SELECT payload->'changes' AS changes, payload->'previous' AS previous
     FROM kumiko_events WHERE aggregate_id = $1 AND type LIKE '%.updated' ORDER BY version DESC LIMIT 1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error(`no updated event for ${id}`);
  return row;
}

async function createdEventValue(target: Target, id: string): Promise<string | undefined> {
  const rows = await asRawClient(stack.db).unsafe<{ value: string | null }>(
    `SELECT payload->>'${target.field}' AS value
     FROM kumiko_events WHERE aggregate_id = $1 AND type LIKE '%.created' ORDER BY version ASC LIMIT 1`,
    [id],
  );
  return rows[0]?.value ?? undefined;
}

async function projectedValue(target: Target, id: string): Promise<string> {
  const rows = await asRawClient(stack.db).unsafe<{ value: string }>(
    `SELECT ${target.column} AS value FROM ${target.table} WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error(`no row ${id}`);
  return row.value;
}

function subjectOf(ciphertext: string | undefined): string {
  if (ciphertext === undefined) return "<no value>";
  return subjectIdToKey(piiCiphertextSubject(ciphertext));
}

async function plaintextOf(ciphertext: string | undefined, field: string): Promise<string> {
  if (ciphertext === undefined) throw new Error("no value");
  return decryptPiiValueForSubject(kms, ciphertext, { requestId: "test" }, field);
}

describe("personal fields on owner transition", () => {
  test("absent -> X rekeys the value under X; pre-owner created event stays tenant-keyed", async () => {
    enableKms();
    const owner = generateId();
    const id = await createRow(ITEM, { name: "Alice" });
    expect(await createdEventValue(ITEM, id)).toStartWith(TENANT_PREFIX);

    await update(ITEM, id, { ownerId: owner });

    expect(await projectedValue(ITEM, id)).toStartWith(userPrefix(owner));
    const event = await lastUpdatedEvent(id);
    expect(event.changes["name"]).toStartWith(userPrefix(owner));
    expect(event.previous["name"]).toStartWith(userPrefix(owner));
    // Pre-owner history stays tenant-keyed: the created event is immutable.
    expect(await createdEventValue(ITEM, id)).toStartWith(TENANT_PREFIX);
    expect((await detail(ITEM, id))["name"]).toBe("Alice");

    await kms.eraseKey({ kind: "user", userId: owner });
    expect((await detail(ITEM, id))["name"]).toBe(PII_ERASED_SENTINEL);
    expect(await plaintextOf(event.changes["name"], "name")).toBe(PII_ERASED_SENTINEL);
    expect(await plaintextOf(event.previous["name"], "name")).toBe(PII_ERASED_SENTINEL);
  });

  test("after backfill re-key and rebuild, forgetting the owner leaves no readable copy", async () => {
    enableKms();
    const owner = generateId();
    const id = await createRow(ITEM, { name: "Alice" });
    await update(ITEM, id, { ownerId: owner });

    const result = await backfillEventPiiEncryption(stack.db, stack.registry, {
      resolveOwnerFromProjection: true,
      rekeyTenantKeyedOwnerFields: true,
    });
    expect(result.failures).toEqual([]);
    await rebuildProjection(ITEM.projection, { db: stack.db, registry: stack.registry });

    expect(await createdEventValue(ITEM, id)).toStartWith(userPrefix(owner));
    await kms.eraseKey({ kind: "user", userId: owner });

    const events = await asRawClient(stack.db).unsafe<{
      created: string | null;
      changes: string | null;
      previous: string | null;
    }>(
      `SELECT payload->>'name' AS created, payload->'changes'->>'name' AS changes,
              payload->'previous'->>'name' AS previous
         FROM kumiko_events WHERE aggregate_id = $1`,
      [id],
    );
    const stored = [
      await projectedValue(ITEM, id),
      ...events.flatMap((event) => [event.created, event.changes, event.previous]),
    ].filter((value): value is string => value !== null);
    expect(stored.length).toBeGreaterThanOrEqual(4);
    for (const value of stored) {
      expect(await plaintextOf(value, "name")).not.toBe("Alice");
    }
  });

  test("X -> Y rekeys the value under Y; forgetting X leaves it readable", async () => {
    enableKms();
    const ownerX = generateId();
    const ownerY = generateId();
    const id = await createRow(ITEM, { name: "Bob", ownerId: ownerX });

    await update(ITEM, id, { ownerId: ownerY });

    expect(await projectedValue(ITEM, id)).toStartWith(userPrefix(ownerY));
    const event = await lastUpdatedEvent(id);
    expect(event.changes["name"]).toStartWith(userPrefix(ownerY));
    expect(event.previous["name"]).toStartWith(userPrefix(ownerX));

    await kms.eraseKey({ kind: "user", userId: ownerX });
    expect((await detail(ITEM, id))["name"]).toBe("Bob");
  });

  test("rebuild reproduces the live subjects and values", async () => {
    enableKms();
    const owner = generateId();
    const ownerX = generateId();
    const ownerY = generateId();
    const absentToOwner = await createRow(ITEM, { name: "Alice" });
    await update(ITEM, absentToOwner, { ownerId: owner });
    const ownerToOwner = await createRow(ITEM, { name: "Bob", ownerId: ownerX });
    await update(ITEM, ownerToOwner, { ownerId: ownerY });

    const ids = [absentToOwner, ownerToOwner];
    const snapshot = async () =>
      Promise.all(
        ids.map(async (id) => ({
          subject: subjectOf(await projectedValue(ITEM, id)),
          name: (await detail(ITEM, id))["name"],
        })),
      );
    const live = await snapshot();
    expect(live.map((entry) => entry.subject)).toEqual([`user:${owner}`, `user:${ownerY}`]);

    await rebuildProjection(ITEM.projection, { db: stack.db, registry: stack.registry });

    expect(await snapshot()).toEqual(live);
  });

  test("X -> absent keeps the value under X and writes no name change", async () => {
    enableKms();
    const owner = generateId();
    const id = await createRow(ITEM, { name: "Carol", ownerId: owner });

    await update(ITEM, id, { ownerId: null });

    expect((await lastUpdatedEvent(id)).changes["name"]).toBeUndefined();
    expect(await projectedValue(ITEM, id)).toStartWith(userPrefix(owner));
    await kms.eraseKey({ kind: "user", userId: owner });
    expect((await detail(ITEM, id))["name"]).toBe(PII_ERASED_SENTINEL);
  });

  test("an update without an owner change does not re-write the personal field", async () => {
    enableKms();
    const owner = generateId();
    const id = await createRow(ITEM, { name: "Dave", ownerId: owner });

    await update(ITEM, id, { note: "plain" });

    expect((await lastUpdatedEvent(id)).changes["name"]).toBeUndefined();
    expect(await projectedValue(ITEM, id)).toStartWith(userPrefix(owner));
  });

  test("encrypted + personal field: X -> Y stays PII(envelope) under Y and reads back", async () => {
    enableKms();
    const ownerX = generateId();
    const ownerY = generateId();
    const id = await createRow(SECRET, { secret: "s3cret", ownerId: ownerX });

    await update(SECRET, id, { ownerId: ownerY });

    const stored = await projectedValue(SECRET, id);
    expect(stored).toStartWith(userPrefix(ownerY));
    expect(await plaintextOf(stored, "secret")).not.toBe("s3cret");
    await kms.eraseKey({ kind: "user", userId: ownerX });
    expect((await detail(SECRET, id))["secret"]).toBe("s3cret");
  });
});

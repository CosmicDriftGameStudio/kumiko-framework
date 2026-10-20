// fw#1610 — subject-annotated searchable fields: ciphertext in events,
// plaintext in derived search index, purged on subject erase.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  subjectIdToKey,
} from "../../crypto/index.ts";
import {
  asRawClient,
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
} from "../../db/index.ts";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import type { ReferenceFieldDef } from "../../engine/types/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { generateId } from "../../utils/index.ts";
import { purgeSearchDocumentsForSubject } from "../purge-subject.ts";

const contactEntity = createEntity({
  table: "read_search_pii_contacts",
  fields: {
    // personal: "self" → subject = entity id. find: "fuzzy" → searchable via derived index.
    label: createTextField({ required: true, maxLength: 100, personal: "self", find: "fuzzy" }),
    note: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      maxLength: 100,
      searchable: true,
    }),
  },
});

const contactTable = buildEntityTable("contact", contactEntity);

const contactFeature = defineFeature("search-pii-probe", (r) => {
  r.entity({ name: "contact", ...contactEntity });
});

// whenAbsent: "self" with a uuid (reference) owner column: only ownerless rows are record-keyed.
const ownerReference: ReferenceFieldDef = { type: "reference", entity: "user" };
const slipEntity = createEntity({
  table: "read_search_pii_slips",
  fields: {
    ownerId: ownerReference,
    label: createTextField({
      maxLength: 100,
      personal: { of: "ownerId", whenAbsent: "self" },
      find: "fuzzy",
    }),
  },
});
const slipTable = buildEntityTable("slip", slipEntity);
const slipFeature = defineFeature("search-pii-slip", (r) => {
  r.entity({ name: "slip", ...slipEntity });
});

const ghostSearchEntity = createEntity({
  table: "read_search_pii_ghosts_missing",
  fields: {
    label: createTextField({ required: true, maxLength: 100, personal: "self", find: "fuzzy" }),
  },
});
const ghostSearchFeature = defineFeature("search-pii-ghost", (r) => {
  r.entity({ name: "ghost", ...ghostSearchEntity });
});

let stack: TestStack;
let kms: InMemoryKmsAdapter;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [contactFeature, slipFeature] });
  await unsafeCreateEntityTable(stack.db, contactEntity, "contact");
  await unsafeCreateEntityTable(stack.db, slipEntity, "slip");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

function executor() {
  return createEventStoreExecutor(contactTable, contactEntity, {
    entityName: "contact",
    searchAdapter: stack.search,
  });
}

function tenantDb() {
  return createTenantDb({ db: stack.db, tenantId: admin.tenantId, mode: "system" });
}

describe("searchable PII derived index (#1610)", () => {
  test("create indexes plaintext; event payload stays ciphertext; erase purges search", async () => {
    const plain = "UniqueSearchPiiLabel1610";
    const created = await executor().create(
      { label: plain, note: "public-note" },
      admin,
      tenantDb(),
    );
    if (!created.isSuccess) throw new Error("create failed");
    const id = String(created.data.id);

    const events = await asRawClient(stack.db).unsafe(
      `SELECT payload FROM kumiko_events WHERE aggregate_id = $1 AND type = 'contact.created' LIMIT 1`,
      [id],
    );
    const payload = (events as { payload: Record<string, unknown> }[])[0]?.payload;
    expect(isPiiCiphertext(payload?.["label"])).toBe(true);
    expect(payload?.["label"]).not.toBe(plain);

    await stack.eventDispatcher?.runOnce();

    const hits = await stack.search.search(admin.tenantId, plain, { filterType: "contact" });
    expect(hits.some((h) => String(h.entityId) === id)).toBe(true);

    // pii: true → subject key is the entity id itself.
    const subject = { kind: "user" as const, userId: id };
    await kms.eraseKey(subject);
    await purgeSearchDocumentsForSubject(
      stack.db,
      stack.registry.features,
      stack.search,
      subjectIdToKey(subject),
      subject,
    );

    const after = await stack.search.search(admin.tenantId, plain, { filterType: "contact" });
    expect(after.some((h) => String(h.entityId) === id)).toBe(false);
  });

  test("consumer treats erased decrypt as remove (no sentinel index)", async () => {
    const plain = "SentinelRebuildLabel1610";
    const created = await executor().create({ label: plain, note: "x" }, admin, tenantDb());
    if (!created.isSuccess) throw new Error("create failed");
    const id = String(created.data.id);

    await stack.eventDispatcher?.runOnce();
    expect(
      (await stack.search.search(admin.tenantId, plain, { filterType: "contact" })).some(
        (h) => String(h.entityId) === id,
      ),
    ).toBe(true);

    await kms.eraseKey({ kind: "user", userId: id });
    // Force re-index path by updating a non-PII field — consumer decrypts
    // label → [[erased]] → remove.
    const updated = await executor().update(
      { id: created.data.id, changes: { note: "y" } },
      admin,
      tenantDb(),
      { skipOptimisticLock: true },
    );
    if (!updated.isSuccess) throw new Error("update failed");
    await stack.eventDispatcher?.runOnce();

    const after = await stack.search.search(admin.tenantId, plain, { filterType: "contact" });
    expect(after.some((h) => String(h.entityId) === id)).toBe(false);
  });
  test("purge finds rows after anonymize rewrote ciphertext (#1610 bugbot)", async () => {
    const plain = "AnonymizedStillPurge1610";
    const created = await executor().create({ label: plain, note: "n" }, admin, tenantDb());
    if (!created.isSuccess) throw new Error("create failed");
    const id = String(created.data.id);
    await stack.eventDispatcher?.runOnce();
    expect(
      (await stack.search.search(admin.tenantId, plain, { filterType: "contact" })).some(
        (h) => String(h.entityId) === id,
      ),
    ).toBe(true);

    // Simulate forget-cleanup anonymize: overwrite searchable PII with plaintext.
    await asRawClient(stack.db).unsafe(
      `UPDATE read_search_pii_contacts SET label = $1 WHERE id = $2`,
      ["[[erased]]", id],
    );

    const subject = { kind: "user" as const, userId: id };
    await purgeSearchDocumentsForSubject(
      stack.db,
      stack.registry.features,
      stack.search,
      subjectIdToKey(subject),
      subject,
    );

    const after = await stack.search.search(admin.tenantId, plain, { filterType: "contact" });
    expect(after.some((h) => String(h.entityId) === id)).toBe(false);
  });

  test("purgeSearchDocumentsForSubject pages through more matching rows than one batch holds", async () => {
    const created = await executor().create(
      { label: "MultiPagePurge1610", note: "n" },
      admin,
      tenantDb(),
    );
    if (!created.isSuccess) throw new Error("create failed");
    const seedId = String(created.data.id);
    const client = asRawClient(stack.db);
    const columns = await client.unsafe<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'read_search_pii_contacts' AND column_name <> 'id'`,
    );
    const columnList = columns.map((c) => `"${c.column_name}"`).join(", ");
    const copies = 1100;
    await client.unsafe(
      `INSERT INTO read_search_pii_contacts ("id", ${columnList})
         SELECT gen_random_uuid(), ${columnList} FROM read_search_pii_contacts, generate_series(1, ${copies})
         WHERE "id" = $1`,
      [seedId],
    );

    const removed: string[] = [];
    const recordingAdapter = Object.assign(Object.create(stack.search), {
      removeBatch: async (_tenantId: string, items: readonly { entityId: string }[]) => {
        for (const item of items) removed.push(String(item.entityId));
      },
    });
    const subject = { kind: "user" as const, userId: seedId };
    await purgeSearchDocumentsForSubject(
      stack.db,
      stack.registry.features,
      recordingAdapter,
      subjectIdToKey(subject),
      subject,
    );

    expect(removed).toHaveLength(copies + 1);
    expect(new Set(removed).size).toBe(copies + 1);
  });

  test("purgeSearchDocumentsForSubject skips missing projection tables (fw#2550)", async () => {
    const plain = "MissingTableStillPurges1610";
    const created = await executor().create({ label: plain, note: "n" }, admin, tenantDb());
    if (!created.isSuccess) throw new Error("create failed");
    const id = String(created.data.id);
    await stack.eventDispatcher?.runOnce();
    expect(
      (await stack.search.search(admin.tenantId, plain, { filterType: "contact" })).some(
        (h) => String(h.entityId) === id,
      ),
    ).toBe(true);

    const subject = { kind: "user" as const, userId: id };
    await kms.eraseKey(subject);
    // Ghost searchable entity never got DDL — must not abort the purge.
    const registry = createRegistry([contactFeature, ghostSearchFeature]);
    await expect(
      purgeSearchDocumentsForSubject(
        stack.db,
        registry.features,
        stack.search,
        subjectIdToKey(subject),
        subject,
      ),
    ).resolves.toBeUndefined();

    const after = await stack.search.search(admin.tenantId, plain, { filterType: "contact" });
    expect(after.some((h) => String(h.entityId) === id)).toBe(false);
  });

  test('record purge removes the ownerless whenAbsent "self" row and keeps an owned row with the same label', async () => {
    const plain = "OwnerlessSelfPurge3811";
    const slipExecutor = createEventStoreExecutor(slipTable, slipEntity, {
      entityName: "slip",
      searchAdapter: stack.search,
    });
    const ownerless = await slipExecutor.create({ label: plain }, admin, tenantDb());
    const owned = await slipExecutor.create(
      { label: plain, ownerId: generateId() },
      admin,
      tenantDb(),
    );
    if (!ownerless.isSuccess || !owned.isSuccess) throw new Error("create failed");
    const ownerlessId = String(ownerless.data.id);
    const ownedId = String(owned.data.id);
    await stack.eventDispatcher?.runOnce();

    // Anonymize rewrote the ciphertext, so only the ownership path can still find the row.
    await asRawClient(stack.db).unsafe(`UPDATE read_search_pii_slips SET label = $1`, [
      "[[erased]]",
    ]);

    const subject = { kind: "record" as const, entity: "slip", id: ownerlessId };
    await purgeSearchDocumentsForSubject(
      stack.db,
      stack.registry.features,
      stack.search,
      subjectIdToKey(subject),
      subject,
    );

    const hits = await stack.search.search(admin.tenantId, plain, { filterType: "slip" });
    expect(hits.some((h) => String(h.entityId) === ownerlessId)).toBe(false);
    expect(hits.some((h) => String(h.entityId) === ownedId)).toBe(true);
  });
});

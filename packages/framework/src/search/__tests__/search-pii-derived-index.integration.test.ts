// fw#1610 — subject-annotated searchable fields: ciphertext in events,
// plaintext in derived search index, purged on subject erase.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
import {
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  subjectIdToKey,
} from "../../crypto";
import { asRawClient, buildEntityTable, createEventStoreExecutor, createTenantDb } from "../../db";
import { createEntity, createTextField, defineFeature } from "../../engine";
import { createEventsTable } from "../../event-store";
import { setupTestStack, type TestStack, TestUsers, unsafeCreateEntityTable } from "../../stack";
import { purgeSearchDocumentsForSubject } from "../purge-subject";

const contactEntity = createEntity({
  table: "read_search_pii_contacts",
  fields: {
    // pii: true → subject = entity id (self). searchable via derived index.
    label: createTextField({ required: true, maxLength: 100, pii: true, searchable: true }),
    note: createTextField({ required: true, maxLength: 100, searchable: true }),
  },
});

const contactTable = buildEntityTable("contact", contactEntity);

const contactFeature = defineFeature("search-pii-probe", (r) => {
  r.entity("contact", contactEntity);
});

let stack: TestStack;
let kms: InMemoryKmsAdapter;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [contactFeature] });
  await unsafeCreateEntityTable(stack.db, contactEntity, "contact");
  await createEventsTable(stack.db);
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
  return createTenantDb(stack.db, admin.tenantId, "system");
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
});

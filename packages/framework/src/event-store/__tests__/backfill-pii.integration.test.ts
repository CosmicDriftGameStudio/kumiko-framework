// backfillEventPiiEncryption (#799): pre-KMS plaintext events get re-
// encrypted in place — entity lifecycle payloads (created / updated
// changes+previous / forgotten previous) AND catalogued custom events.
// Pre-KMS-forgotten subjects (detectable only via their *.forgotten event)
// get [[erased]] instead of a freshly minted key. After the backfill,
// applyEntityEvent (the rebuild primitive) materializes ciphertext AND the
// blind-index column, so equality lookups keep working.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
} from "../../crypto";
import { applyEntityEvent } from "../../db/apply-entity-event";
import { asRawClient, fetchOne } from "../../db/query";
import { buildEntityTable } from "../../db/table-builder";
import { defineFeature } from "../../engine/define-feature";
import { createEntity, createTextField } from "../../engine/factories";
import { createRegistry } from "../../engine/registry";
import type { Registry, TenantId } from "../../engine/types";
import { createTestDb, type TestDb, unsafeCreateEntityTable } from "../../stack";
import { generateId } from "../../utils";
import { backfillEventPiiEncryption } from "../backfill-pii";
import { append, loadAggregate } from "../event-store";
import { createEventsTable } from "../events-schema";

const TENANT = "00000000-0000-4000-8000-000000000001" as TenantId;
const BIDX_KEY = Buffer.alloc(32, 5).toString("base64");

const contactEntity = createEntity({
  fields: {
    email: createTextField({ required: true, pii: true, lookupable: true }),
    displayName: createTextField(),
  },
});
const contactTable = buildEntityTable("contact", contactEntity);

const crmFeature = defineFeature("crm", (r) => {
  r.entity("contact", contactEntity);
});

const mailerFeature = defineFeature("mailer", (r) => {
  r.defineEvent(
    "ping",
    z.object({ targetId: z.string().nullable(), address: z.string().nullable() }),
    { piiFields: { address: { subjectField: "targetId" } } },
  );
});

let testDb: TestDb;
let registry: Registry;
let kms: InMemoryKmsAdapter;

async function appendPlain(
  aggregateId: string,
  aggregateType: string,
  type: string,
  payload: Record<string, unknown>,
  expectedVersion = 0,
): Promise<void> {
  await append(testDb.db, {
    aggregateId,
    aggregateType,
    tenantId: TENANT,
    expectedVersion,
    type,
    payload,
    metadata: { userId: "system" },
  });
}

beforeAll(async () => {
  testDb = await createTestDb();
  registry = createRegistry([crmFeature, mailerFeature]);
  await createEventsTable(testDb.db);
  await unsafeCreateEntityTable(testDb.db, contactEntity, "contact");
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  const raw = asRawClient(testDb.db);
  await raw.unsafe(`TRUNCATE "kumiko_events" RESTART IDENTITY`);
  await raw.unsafe(`TRUNCATE "${contactTable.tableName}"`);
  // Plaintext era: NO KMS while the legacy events are appended.
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
});

function armKms(): void {
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
}

describe("backfillEventPiiEncryption", () => {
  test("encrypts entity lifecycle payloads: created flat, updated changes+previous", async () => {
    const c1 = generateId();
    await appendPlain(c1, "contact", "contact.created", {
      id: c1,
      email: "old@x.com",
      displayName: "Alice",
    });
    await appendPlain(
      c1,
      "contact",
      "contact.updated",
      { changes: { email: "new@x.com" }, previous: { id: c1, email: "old@x.com" } },
      1,
    );

    armKms();
    const result = await backfillEventPiiEncryption(testDb.db, registry);

    expect(result.failures).toEqual([]);
    expect(result.updatedEvents).toBe(2);
    expect(result.encryptedFields).toBe(3);

    const events = await loadAggregate(testDb.db, c1, TENANT);
    const created = events[0]?.payload as Record<string, unknown>;
    expect(isPiiCiphertext(created["email"])).toBe(true);
    expect(String(created["email"])).toContain(`user:${c1}`);
    expect(created["displayName"]).toBe("Alice");

    const updated = events[1]?.payload as {
      changes: Record<string, unknown>;
      previous: Record<string, unknown>;
    };
    expect(isPiiCiphertext(updated.changes["email"])).toBe(true);
    expect(isPiiCiphertext(updated.previous["email"])).toBe(true);
  });

  test("pre-KMS-forgotten aggregate gets [[erased]], not a fresh key", async () => {
    const c2 = generateId();
    await appendPlain(c2, "contact", "contact.created", { id: c2, email: "gone@x.com" });
    await appendPlain(
      c2,
      "contact",
      "contact.forgotten",
      { previous: { id: c2, email: "gone@x.com" } },
      1,
    );

    armKms();
    const result = await backfillEventPiiEncryption(testDb.db, registry);

    expect(result.failures).toEqual([]);
    expect(result.erasedFields).toBe(2);
    const events = await loadAggregate(testDb.db, c2, TENANT);
    const created = events[0]?.payload as Record<string, unknown>;
    expect(created["email"]).toBe(PII_ERASED_SENTINEL);
    const forgotten = events[1]?.payload as { previous: Record<string, unknown> };
    expect(forgotten.previous["email"]).toBe(PII_ERASED_SENTINEL);
  });

  test("catalogued custom events: encrypt under target's DEK; forgotten target → [[erased]]", async () => {
    const forgottenUser = generateId();
    await appendPlain(forgottenUser, "contact", "contact.created", {
      id: forgottenUser,
      email: "f@x.com",
    });
    await appendPlain(
      forgottenUser,
      "contact",
      "contact.forgotten",
      { previous: { id: forgottenUser, email: "f@x.com" } },
      1,
    );

    const p1 = generateId();
    const p2 = generateId();
    const p3 = generateId();
    await appendPlain(p1, "ping", "mailer:event:ping", {
      targetId: "u-7",
      address: "u7@x.com",
    });
    await appendPlain(p2, "ping", "mailer:event:ping", {
      targetId: forgottenUser,
      address: "f@x.com",
    });
    await appendPlain(p3, "ping", "mailer:event:ping", { targetId: null, address: "ops@x.com" });

    armKms();
    const result = await backfillEventPiiEncryption(testDb.db, registry);

    expect(result.failures).toEqual([]);
    const alive = (await loadAggregate(testDb.db, p1, TENANT))[0]?.payload as Record<
      string,
      unknown
    >;
    expect(isPiiCiphertext(alive["address"])).toBe(true);
    expect(String(alive["address"])).toContain("user:u-7");

    const erased = (await loadAggregate(testDb.db, p2, TENANT))[0]?.payload as Record<
      string,
      unknown
    >;
    expect(erased["address"]).toBe(PII_ERASED_SENTINEL);

    // No subject → no key to shred; stays plaintext (documented rollout gap).
    const system = (await loadAggregate(testDb.db, p3, TENANT))[0]?.payload as Record<
      string,
      unknown
    >;
    expect(system["address"]).toBe("ops@x.com");
  });

  test("idempotent: second run updates nothing; dryRun writes nothing", async () => {
    const c1 = generateId();
    await appendPlain(c1, "contact", "contact.created", { id: c1, email: "a@x.com" });

    armKms();
    const dry = await backfillEventPiiEncryption(testDb.db, registry, { dryRun: true });
    expect(dry.updatedEvents).toBe(1);
    const untouched = (await loadAggregate(testDb.db, c1, TENANT))[0]?.payload as Record<
      string,
      unknown
    >;
    expect(untouched["email"]).toBe("a@x.com");

    const first = await backfillEventPiiEncryption(testDb.db, registry);
    expect(first.updatedEvents).toBe(1);
    const second = await backfillEventPiiEncryption(testDb.db, registry);
    expect(second.updatedEvents).toBe(0);
    expect(second.failures).toEqual([]);
  });

  test("small batchSize pages through the estate completely", async () => {
    const ids = [generateId(), generateId(), generateId(), generateId(), generateId()];
    for (const id of ids) {
      await appendPlain(id, "contact", "contact.created", { id, email: `${id}@x.com` });
    }

    armKms();
    const result = await backfillEventPiiEncryption(testDb.db, registry, { batchSize: 2 });
    expect(result.scannedEvents).toBe(5);
    expect(result.updatedEvents).toBe(5);
  });

  test("after backfill, applyEntityEvent (rebuild) materializes ciphertext + blind index", async () => {
    const c1 = generateId();
    await appendPlain(c1, "contact", "contact.created", { id: c1, email: "login@x.com" });

    armKms();
    configureBlindIndexKey(BIDX_KEY);
    await backfillEventPiiEncryption(testDb.db, registry);

    const events = await loadAggregate(testDb.db, c1, TENANT);
    const created = events[0];
    if (!created) throw new Error("missing created event");
    await applyEntityEvent(created, contactTable, contactEntity, testDb.db);

    const row = await fetchOne(testDb.db, contactTable, { id: c1 });
    expect(isPiiCiphertext(row?.["email"])).toBe(true);
    const rawRows = (await asRawClient(testDb.db).unsafe(
      `SELECT "email_bidx" FROM "${contactTable.tableName}" WHERE "id" = $1`,
      [c1],
    )) as ReadonlyArray<Record<string, unknown>>;
    expect(String(rawRows[0]?.["email_bidx"])).toStartWith("kumiko-bidx:v1:");
  });

  test("throws without a configured KMS", async () => {
    expect(backfillEventPiiEncryption(testDb.db, registry)).rejects.toThrow(
      /requires a configured subject KMS/,
    );
  });
});

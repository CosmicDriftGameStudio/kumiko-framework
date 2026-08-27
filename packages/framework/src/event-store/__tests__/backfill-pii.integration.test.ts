// backfillEventPiiEncryption (#799): pre-KMS plaintext events get re-
// encrypted in place — entity lifecycle payloads (created / updated
// changes+previous / forgotten previous) AND catalogued custom events.
// Pre-KMS-forgotten subjects (detectable only via their *.forgotten event)
// get [[erased]] instead of a freshly minted key. After the backfill,
// applyEntityEvent (the rebuild primitive) materializes ciphertext AND the
// blind-index column, so equality lookups keep working.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/testing";
import { z } from "zod";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  KeyNotFoundError,
  PgKmsAdapter,
  PII_ERASED_SENTINEL,
} from "../../crypto";
import { applyEntityEvent } from "../../db/apply-entity-event";
import { backfillEventPiiEncryption } from "../../db/queries/backfill-pii";
import { asRawClient, fetchOne } from "../../db/query";
import { buildEntityTable } from "../../db/table-builder";
import { defineFeature } from "../../engine/define-feature";
import { createEntity, createTextField } from "../../engine/factories";
import { createRegistry } from "../../engine/registry";
import type { Registry, TenantId } from "../../engine/types";
import { createTestDb, type TestDb, unsafeCreateEntityTable } from "../../stack";
import { generateId } from "../../utils";
import { append, loadAggregate } from "../event-store";
import { createEventsTable } from "../events-schema";

const TENANT = "00000000-0000-4000-8000-000000000001" as TenantId;
const BIDX_KEY = Buffer.alloc(32, 5).toString("base64");

const contactEntity = createEntity({
  fields: {
    email: createTextField({ required: true, personal: "self", find: "exact" }),
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

// personal: { of } (not "self") — the named owner field can legitimately be
// absent from an old event's payload, unlike contact.email (self-subject via row id).
const noteEntity = createEntity({
  fields: {
    authorId: createTextField(),
    body: createTextField({ personal: { of: "authorId" }, find: "none" }),
  },
});
const noteTable = buildEntityTable("note", noteEntity);

const notesFeature = defineFeature("notes", (r) => {
  r.entity("note", noteEntity);
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
  registry = createRegistry([crmFeature, mailerFeature, notesFeature]);
  await createEventsTable(testDb.db);
  await unsafeCreateEntityTable(testDb.db, contactEntity, "contact");
  await unsafeCreateEntityTable(testDb.db, noteEntity, "note");
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  const raw = asRawClient(testDb.db);
  await raw.unsafe(`TRUNCATE "kumiko_events" RESTART IDENTITY`);
  await raw.unsafe(`TRUNCATE "${contactTable.tableName}"`);
  await raw.unsafe(`TRUNCATE "${noteTable.tableName}"`);
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

  test("dryRun mints no subject key (fw#2255) and predicts the real run's counters exactly", async () => {
    const c1 = generateId();
    await appendPlain(c1, "contact", "contact.created", { id: c1, email: "a@x.com" });

    armKms();
    const dry = await backfillEventPiiEncryption(testDb.db, registry, { dryRun: true });
    expect(dry.failures).toEqual([]);
    expect(dry.encryptedFields).toBe(1);

    // No key exists in the separate subject-keys store — dry-run must not
    // have called kms.createKey.
    await expect(kms.getKey({ kind: "user", userId: c1 })).rejects.toThrow(KeyNotFoundError);

    const real = await backfillEventPiiEncryption(testDb.db, registry);
    expect(real.updatedEvents).toBe(dry.updatedEvents);
    expect(real.encryptedFields).toBe(dry.encryptedFields);
    expect(real.erasedFields).toBe(dry.erasedFields);
    expect(real.ownerFromProjection).toBe(dry.ownerFromProjection);
    expect(real.erasedUnresolvable).toBe(dry.erasedUnresolvable);
  });

  // The prod bug this regression test guards (fw#2255) only ever manifested
  // against a real subject-keys store (kumiko_subject_keys 20→22 rows during
  // a dry run) — the InMemoryKmsAdapter tests above can't see that, since
  // there is no row store to leak into. Run the same dry-run invariant
  // against PgKmsAdapter on real Postgres and assert on the table itself.
  test("dryRun against PgKmsAdapter mints no row in kumiko_subject_keys (fw#2255)", async () => {
    const c1 = generateId();
    await appendPlain(c1, "contact", "contact.created", { id: c1, email: "a@x.com" });

    const baseUrl = process.env["TEST_DATABASE_URL"];
    if (!baseUrl) throw new Error("Missing required env var: TEST_DATABASE_URL");
    const pgKms = new PgKmsAdapter({
      databaseUrl: baseUrl.replace(/\/[^/]+$/, `/${testDb.dbName}`),
      platformKek: randomBytes(32).toString("base64"),
      maxConnections: 1,
    });
    const raw = asRawClient(testDb.db);
    try {
      // health() creates kumiko_subject_keys lazily so the counts below see
      // a real (empty) table instead of failing on "relation does not exist".
      await pgKms.health();
      configurePiiSubjectKms(pgKms);

      const before = (await raw.unsafe(
        `SELECT count(*)::int AS n FROM kumiko_subject_keys`,
      )) as ReadonlyArray<{ n: number }>;

      const dry = await backfillEventPiiEncryption(testDb.db, registry, { dryRun: true });
      expect(dry.failures).toEqual([]);
      expect(dry.encryptedFields).toBe(1);

      const afterDry = (await raw.unsafe(
        `SELECT count(*)::int AS n FROM kumiko_subject_keys`,
      )) as ReadonlyArray<{ n: number }>;
      expect(afterDry[0]?.n).toBe(before[0]?.n);
      await expect(
        pgKms.getKey({ kind: "user", userId: c1 }, { requestId: "backfill-pii-test" }),
      ).rejects.toThrow(KeyNotFoundError);

      // The real run does mint exactly one row through the same Pg path —
      // proves the invariant above is a genuine "dry run creates nothing",
      // not an adapter that never creates rows at all.
      const real = await backfillEventPiiEncryption(testDb.db, registry);
      expect(real.encryptedFields).toBe(1);
      const afterReal = (await raw.unsafe(
        `SELECT count(*)::int AS n FROM kumiko_subject_keys`,
      )) as ReadonlyArray<{ n: number }>;
      expect(afterReal[0]?.n).toBe((before[0]?.n ?? 0) + 1);
      await expect(
        pgKms.getKey({ kind: "user", userId: c1 }, { requestId: "backfill-pii-test" }),
      ).resolves.toBeInstanceOf(Buffer);
    } finally {
      await pgKms.close();
    }
  });

  test("dryRun on a KMS-era-erased subject (no *.forgotten event) predicts [[erased]] without touching the key store", async () => {
    const author = generateId();
    const noteId = generateId();
    await appendPlain(noteId, "note", "note.created", {
      id: noteId,
      authorId: author,
      body: "secret",
    });

    armKms();
    // Layer 1 (header comment): a subject erased in the KMS era, with no
    // *.forgotten event on the stream to catch it via isForgottenSubject.
    const subject = { kind: "user" as const, userId: author };
    await kms.createKey(subject);
    await kms.eraseKey(subject);

    const dry = await backfillEventPiiEncryption(testDb.db, registry, { dryRun: true });
    expect(dry.failures).toEqual([]);
    expect(dry.erasedFields).toBe(1);
    expect(dry.encryptedFields).toBe(0);

    const untouched = (await loadAggregate(testDb.db, noteId, TENANT))[0]?.payload as Record<
      string,
      unknown
    >;
    expect(untouched["body"]).toBe("secret");

    const real = await backfillEventPiiEncryption(testDb.db, registry);
    expect(real.erasedFields).toBe(dry.erasedFields);
    expect(real.encryptedFields).toBe(dry.encryptedFields);
  });

  test("dryRun over a catalogued custom event mints no key for its payload-resolved subject", async () => {
    const p1 = generateId();
    await appendPlain(p1, "ping", "mailer:event:ping", {
      targetId: "u-7",
      address: "u7@x.com",
    });

    armKms();
    const dry = await backfillEventPiiEncryption(testDb.db, registry, { dryRun: true });
    expect(dry.failures).toEqual([]);
    expect(dry.encryptedFields).toBe(1);

    // "u-7" comes straight from the event payload, not from aggregate_id —
    // the catalog path is the one that mints a key for a subject that never
    // existed anywhere else (the reported phronexsis prod symptom).
    await expect(kms.getKey({ kind: "user", userId: "u-7" })).rejects.toThrow(KeyNotFoundError);

    const real = await backfillEventPiiEncryption(testDb.db, registry);
    expect(real.encryptedFields).toBe(dry.encryptedFields);
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

describe("backfillEventPiiEncryption: owner-resolution chain (fw#2266)", () => {
  async function insertNoteProjectionRow(id: string, authorId: string): Promise<void> {
    await asRawClient(testDb.db).unsafe(
      `INSERT INTO "${noteTable.tableName}" (id, tenant_id, author_id, body) VALUES ($1, $2, $3, $4)`,
      [id, TENANT, authorId, "projection-row-body"],
    );
  }

  test("payload missing owner + projection row has it: resolveOwnerFromProjection encrypts, no failures", async () => {
    const author = generateId();
    const noteId = generateId();
    await insertNoteProjectionRow(noteId, author);
    // Legacy event predating the authorId column — payload never carried it.
    await appendPlain(noteId, "note", "note.created", { id: noteId, body: "old plaintext note" });

    armKms();
    const result = await backfillEventPiiEncryption(testDb.db, registry, {
      resolveOwnerFromProjection: true,
    });

    expect(result.failures).toEqual([]);
    expect(result.encryptedFields).toBe(1);
    expect(result.ownerFromProjection).toBe(1);

    const created = (await loadAggregate(testDb.db, noteId, TENANT))[0]?.payload as Record<
      string,
      unknown
    >;
    expect(isPiiCiphertext(created["body"])).toBe(true);
    expect(String(created["body"])).toContain(`user:${author}`);
  });

  test("same event without the flags: stays in failures (default behavior unchanged)", async () => {
    const author = generateId();
    const noteId = generateId();
    await insertNoteProjectionRow(noteId, author);
    await appendPlain(noteId, "note", "note.created", { id: noteId, body: "old plaintext note" });

    armKms();
    const result = await backfillEventPiiEncryption(testDb.db, registry);

    expect(result.encryptedFields).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.reason).toContain("resolveOwnerFromProjection");
    expect(result.failures[0]?.reason).toContain("eraseUnresolvableSubjects");

    const created = (await loadAggregate(testDb.db, noteId, TENANT))[0]?.payload as Record<
      string,
      unknown
    >;
    expect(created["body"]).toBe("old plaintext note");
  });

  test("owner missing from payload AND projection: eraseUnresolvableSubjects sentinels the field", async () => {
    const noteId = generateId();
    // No projection row for this aggregate — hard-deleted, or never rebuilt.
    await appendPlain(noteId, "note", "note.created", { id: noteId, body: "orphaned note" });

    armKms();
    const result = await backfillEventPiiEncryption(testDb.db, registry, {
      resolveOwnerFromProjection: true,
      eraseUnresolvableSubjects: true,
    });

    expect(result.failures).toEqual([]);
    expect(result.erasedFields).toBe(1);
    expect(result.erasedUnresolvable).toBe(1);

    const created = (await loadAggregate(testDb.db, noteId, TENANT))[0]?.payload as Record<
      string,
      unknown
    >;
    expect(created["body"]).toBe(PII_ERASED_SENTINEL);
  });

  test("already-ciphertext field with unresolvable owner is left untouched (no data loss)", async () => {
    // Produce genuine ciphertext under a real, resolvable subject first.
    const author = generateId();
    const seedId = generateId();
    await appendPlain(seedId, "note", "note.created", {
      id: seedId,
      authorId: author,
      body: "seed",
    });

    armKms();
    await backfillEventPiiEncryption(testDb.db, registry);
    const seeded = (await loadAggregate(testDb.db, seedId, TENANT))[0]?.payload as Record<
      string,
      unknown
    >;
    const ciphertext = seeded["body"];
    expect(isPiiCiphertext(ciphertext)).toBe(true);

    // New event: body already holds that ciphertext, owner unresolvable
    // (no authorId in payload, no projection row for THIS aggregate).
    const noteId = generateId();
    await appendPlain(noteId, "note", "note.created", { id: noteId, body: ciphertext });

    const result = await backfillEventPiiEncryption(testDb.db, registry, {
      resolveOwnerFromProjection: true,
      eraseUnresolvableSubjects: true,
    });

    expect(result.failures).toEqual([]);
    expect(result.erasedUnresolvable).toBe(0);
    expect(result.encryptedFields).toBe(0);
    expect(result.erasedFields).toBe(0);

    const created = (await loadAggregate(testDb.db, noteId, TENANT))[0]?.payload as Record<
      string,
      unknown
    >;
    expect(created["body"]).toBe(ciphertext);
  });

  test("payload owner differs from projection owner: payload wins, ownerFromProjection stays 0", async () => {
    const payloadAuthor = generateId();
    const projectionAuthor = generateId();
    const noteId = generateId();
    await insertNoteProjectionRow(noteId, projectionAuthor);
    // Ownership changed since this event was written — payload is the
    // historical truth, the projection only today's state. Stage 2 must
    // fill gaps, never override a value stage 1 already resolved.
    await appendPlain(noteId, "note", "note.created", {
      id: noteId,
      authorId: payloadAuthor,
      body: "old plaintext note",
    });

    armKms();
    const result = await backfillEventPiiEncryption(testDb.db, registry, {
      resolveOwnerFromProjection: true,
    });

    expect(result.failures).toEqual([]);
    expect(result.encryptedFields).toBe(1);
    expect(result.ownerFromProjection).toBe(0);

    const created = (await loadAggregate(testDb.db, noteId, TENANT))[0]?.payload as Record<
      string,
      unknown
    >;
    expect(isPiiCiphertext(created["body"])).toBe(true);
    expect(String(created["body"])).toContain(`user:${payloadAuthor}`);
  });

  test("pii field absent from the section with an unresolvable owner: skipped, no failure (no flags)", async () => {
    const noteId = generateId();
    // No "body" key at all, no authorId, no projection row — the value
    // guard skips owner resolution entirely before it could ever fail.
    await appendPlain(noteId, "note", "note.created", { id: noteId });

    armKms();
    const result = await backfillEventPiiEncryption(testDb.db, registry);

    expect(result.failures).toEqual([]);
    expect(result.updatedEvents).toBe(0);
  });
});

describe("backfillEventPiiEncryption: raw jsonb column type (fw#2253)", () => {
  // The UPDATE used to wrap outcome.payload in JSON.stringify before handing
  // it to the ::jsonb cast — Bun.SQL already serializes objects, so the
  // double encoding produced a jsonb STRING scalar instead of an object.
  // loadAggregate stayed green either way: the typed read path (bun-db's
  // coerceRow) re-parses string-shaped jsonb columns on the way out, which
  // cancels the write-side bug out. Only raw SQL consumers (this query,
  // GDPR exports, MSP replays) saw the corruption, so assert on the column
  // type directly instead of going through loadAggregate.
  test("UPDATE writes payload as a jsonb object, not a double-encoded string", async () => {
    const c1 = generateId();
    await appendPlain(c1, "contact", "contact.created", { id: c1, email: "raw@x.com" });

    armKms();
    const result = await backfillEventPiiEncryption(testDb.db, registry);
    expect(result.updatedEvents).toBe(1);

    const rows = (await asRawClient(testDb.db).unsafe(
      `SELECT jsonb_typeof(payload) AS t FROM "kumiko_events" WHERE aggregate_id = $1`,
      [c1],
    )) as ReadonlyArray<{ t: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.t).toBe("object");
  });
});

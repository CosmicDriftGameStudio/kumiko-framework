// runPiiEventBackfill: an annotation added AFTER events were stored gets those
// events re-encrypted on boot, once per annotation state (fingerprint), with
// cheap catch-up passes afterwards.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetBlindIndexKeyForTests } from "../../crypto/blind-index.js";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  decryptPiiValueForSubject,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  type KmsContext,
  type SubjectId,
} from "../../crypto/index.js";
import { resetPiiSubjectKmsForTests } from "../../crypto/pii-field-encryption.js";
import { table as pgTable, text as pgText, uuid as pgUuid } from "../../db/dialect.js";
import { asRawClient } from "../../db/query.js";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineEntityQueryHandler,
  defineEntityWriteHandler,
  defineFeature,
} from "../../engine/index.js";
import type { EntityDefinition, Registry, TenantId } from "../../engine/types/index.js";
import { createSnapshotsTable, saveSnapshot } from "../../event-store/index.js";
import { getConsumerState } from "../../pipeline/index.js";
import { resetEventStore, setupTestStack, type TestStack, TestUsers } from "../../stack/index.js";
import { createPendingRebuildsTable } from "../pending-rebuilds.js";
import { type PiiEventBackfillResult, runPiiEventBackfill } from "../pii-event-backfill.js";

const BIDX_KEY = Buffer.alloc(32, 7).toString("base64");
const CONTACT_TABLE = "read_pii_backfill_contacts";
const MSP_TABLE = "read_pii_backfill_contact_phones";
const MSP_NAME = "crm:projection:contact-phones";
const KMS_CTX: KmsContext = { requestId: "pii-event-backfill-test" };
const admin = TestUsers.admin;

const contactPhonesTable = pgTable(MSP_TABLE, {
  id: pgUuid("id").primaryKey(),
  tenantId: pgUuid("tenant_id").notNull(),
  phone: pgText("phone"),
});

// MSP apply receives the raw event payload, so this table holds whatever the event held.
let failMspApply = false;

function buildContactEntity(phoneIsPii: boolean): EntityDefinition {
  return createEntity({
    table: CONTACT_TABLE,
    fields: {
      email: createTextField({ required: true, personal: "self", find: "exact" }),
      phone: phoneIsPii
        ? createTextField({ personal: "self", find: "none" })
        : createTextField({ personal: false, reason: "test_fixture" }),
    },
  });
}

function buildCrmFeature(entity: EntityDefinition) {
  return defineFeature("crm", (r) => {
    r.entity("contact", entity);
    r.writeHandler(
      defineEntityWriteHandler("contact:create", entity, { access: { roles: ["Admin"] } }),
    );
    r.queryHandler(
      defineEntityQueryHandler("contact:detail", entity, { access: { roles: ["Admin"] } }),
    );
    r.multiStreamProjection({
      name: "contact-phones",
      table: contactPhonesTable,
      apply: {
        "contact.created": async (event, tx) => {
          if (failMspApply) throw new Error("msp apply failure (test)");
          const payload = event.payload as { phone?: string };
          await asRawClient(tx).unsafe(
            `INSERT INTO "${MSP_TABLE}" (id, tenant_id, phone) VALUES ($1::uuid, $2::uuid, $3)
             ON CONFLICT (id) DO UPDATE SET phone = EXCLUDED.phone`,
            [event.aggregateId, event.tenantId, payload.phone ?? null],
          );
        },
      },
    });
  });
}

const featureV1 = buildCrmFeature(buildContactEntity(false));
const featureV2 = buildCrmFeature(buildContactEntity(true));
const registryV1: Registry = createRegistry([featureV1]);

// Throws a plain error (not KeyErasedError) once `failAfterKeys` DEKs exist,
// i.e. an outage of the key store rather than a forgotten subject.
class FlakyKmsAdapter extends InMemoryKmsAdapter {
  failAfterKeys = Number.POSITIVE_INFINITY;
  private createdKeys = 0;

  override async createKey(subject: SubjectId): Promise<void> {
    if (this.createdKeys >= this.failAfterKeys) throw new Error("kms outage");
    await super.createKey(subject);
    this.createdKeys++;
  }
}

let stack: TestStack;
let registryV2: Registry;
let kms: FlakyKmsAdapter;

type EventPayloadRow = { id: string; aggregate_id: string; payload: Record<string, unknown> };

beforeAll(async () => {
  stack = await setupTestStack({ features: [featureV2] });
  registryV2 = stack.registry;
  await createSnapshotsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  const raw = asRawClient(stack.db);
  await resetEventStore(stack, [CONTACT_TABLE, MSP_TABLE]);
  failMspApply = false;
  await raw.unsafe(`DROP TABLE IF EXISTS "kumiko_pii_backfill_state", "kumiko_pending_rebuilds"`);
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
  kms = new FlakyKmsAdapter();
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
});

function armKms(): void {
  configureBlindIndexKey(BIDX_KEY);
  configurePiiSubjectKms(kms);
}

function disarmKms(): void {
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
}

async function createContact(index: number): Promise<{ id: string; email: string; phone: string }> {
  const email = `contact${index}@example.com`;
  const phone = `+49 30 000${index}`;
  const { id } = await stack.http.writeOk<{ id: string }>(
    "crm:write:contact:create",
    { email, phone },
    admin,
  );
  return { id, email, phone };
}

async function drainDispatcher(): Promise<void> {
  await stack.eventDispatcher?.runOnce();
}

async function readMspRows(): Promise<ReadonlyArray<{ id: string; phone: string | null }>> {
  return (await asRawClient(stack.db).unsafe(
    `SELECT "id", "phone" FROM "${MSP_TABLE}" ORDER BY "phone"`,
  )) as ReadonlyArray<{ id: string; phone: string | null }>;
}

async function countPendingRebuilds(): Promise<number> {
  const rows = (await asRawClient(stack.db).unsafe(
    `SELECT count(*)::int AS "n" FROM "kumiko_pending_rebuilds"`,
  )) as ReadonlyArray<{ n: number }>;
  return rows[0]?.n ?? 0;
}

async function readEvents(): Promise<readonly EventPayloadRow[]> {
  return (await asRawClient(stack.db).unsafe(
    `SELECT "id"::text AS "id", "aggregate_id", "payload" FROM "kumiko_events" ORDER BY "id"`,
  )) as ReadonlyArray<EventPayloadRow>;
}

async function readPayloadsAsText(): Promise<string> {
  const rows = (await asRawClient(stack.db).unsafe(
    `SELECT "payload"::text AS "payload" FROM "kumiko_events" ORDER BY "id"`,
  )) as ReadonlyArray<{ payload: string }>;
  return rows.map((r) => r.payload).join("\n");
}

async function readState(): Promise<
  { cursor: string; completed: boolean; failedEventIds: string[] }[]
> {
  return (await asRawClient(stack.db).unsafe(
    `SELECT "cursor_event_id"::text AS "cursor", "completed_at" IS NOT NULL AS "completed",
            "failed_event_ids"::text[] AS "failedEventIds"
       FROM "kumiko_pii_backfill_state"`,
  )) as { cursor: string; completed: boolean; failedEventIds: string[] }[];
}

async function snapshotCount(aggregateId: string): Promise<number> {
  const rows = (await asRawClient(stack.db).unsafe(
    `SELECT count(*)::int AS "n" FROM "kumiko_snapshots" WHERE "aggregate_id" = $1`,
    [aggregateId],
  )) as ReadonlyArray<{ n: number }>;
  return rows[0]?.n ?? 0;
}

function requireContact<T extends { id: string }>(contacts: readonly T[], id: string): T {
  const contact = contacts.find((c) => c.id === id);
  if (!contact) throw new Error(`no contact ${id}`);
  return contact;
}

function expectRan(
  result: PiiEventBackfillResult,
): Extract<PiiEventBackfillResult, { status: "ran" }> {
  if (result.status !== "ran")
    throw new Error(`expected status "ran", got skipped (${result.reason})`);
  return result;
}

async function decryptField(value: unknown, field: string): Promise<string> {
  if (typeof value !== "string") throw new Error(`${field} is not a string`);
  return decryptPiiValueForSubject(kms, value, KMS_CTX, field);
}

describe("runPiiEventBackfill", () => {
  test("a field annotated after the fact: full run encrypts old events, unchanged annotations stay put", async () => {
    const contact = await createContact(1);

    armKms();
    const v1 = expectRan(await runPiiEventBackfill(stack.db, registryV1));
    expect(v1.mode).toBe("full");
    const afterV1 = (await readEvents())[0]?.payload;
    expect(isPiiCiphertext(afterV1?.["email"])).toBe(true);
    expect(afterV1?.["phone"]).toBe(contact.phone);

    const v2 = expectRan(await runPiiEventBackfill(stack.db, registryV2));
    expect(v2.mode).toBe("full");
    expect(v2.failures).toEqual([]);
    const afterV2 = (await readEvents())[0]?.payload;
    expect(isPiiCiphertext(afterV2?.["phone"])).toBe(true);
    expect(await decryptField(afterV2?.["phone"], "phone")).toBe(contact.phone);
    expect(await decryptField(afterV2?.["email"], "email")).toBe(contact.email);
  });

  test("second run with the same annotations is a catch-up that changes nothing", async () => {
    await createContact(1);
    await createContact(2);
    armKms();
    expectRan(await runPiiEventBackfill(stack.db, registryV2));
    const payloadsAfterFirst = await readPayloadsAsText();

    const second = expectRan(await runPiiEventBackfill(stack.db, registryV2));

    expect(second.mode).toBe("catch-up");
    expect(second.updatedEvents).toBe(0);
    expect(second.queuedTables).toEqual([]);
    expect(second.rebuild).toBeNull();
    expect(await readPayloadsAsText()).toBe(payloadsAfterFirst);
  });

  test("queued projection rebuild materializes ciphertext and blind index; HTTP read stays plaintext", async () => {
    const contact = await createContact(1);
    const raw = asRawClient(stack.db);
    const before = (await raw.unsafe(`SELECT "email" FROM "${CONTACT_TABLE}"`)) as ReadonlyArray<{
      email: string;
    }>;
    expect(before[0]?.email).toBe(contact.email);

    armKms();
    const result = expectRan(await runPiiEventBackfill(stack.db, registryV2));

    expect([...result.queuedTables].sort()).toEqual([CONTACT_TABLE, MSP_TABLE].sort());
    expect(result.rebuild?.failed).toEqual([]);
    expect(result.rebuild?.rebuilt.length).toBe(2);
    const rows = (await raw.unsafe(`SELECT * FROM "${CONTACT_TABLE}"`)) as ReadonlyArray<
      Record<string, unknown>
    >;
    expect(rows).toHaveLength(1);
    expect(isPiiCiphertext(rows[0]?.["email"])).toBe(true);
    expect(isPiiCiphertext(rows[0]?.["phone"])).toBe(true);
    expect(typeof rows[0]?.["email_bidx"]).toBe("string");
    const pending = (await raw.unsafe(
      `SELECT count(*)::int AS "n" FROM "kumiko_pending_rebuilds"`,
    )) as ReadonlyArray<{ n: number }>;
    expect(pending[0]?.n).toBe(0);

    const detail = await stack.http.queryOk<Record<string, unknown>>(
      "crm:query:contact:detail",
      { id: contact.id },
      admin,
    );
    expect(detail["email"]).toBe(contact.email);
    expect(detail["phone"]).toBe(contact.phone);
  });

  test("multi-stream projection with a table is rebuilt: plaintext becomes ciphertext, live consumer keeps going", async () => {
    const first = await createContact(1);
    await drainDispatcher();
    expect((await readMspRows()).map((r) => r.phone)).toEqual([first.phone]);

    armKms();
    const result = expectRan(await runPiiEventBackfill(stack.db, registryV2));

    expect(result.queuedTables).toContain(MSP_TABLE);
    expect(result.rebuild?.failed).toEqual([]);
    expect(result.rebuild?.rebuilt.map((r) => r.projection)).toContain(MSP_NAME);
    const rows = await readMspRows();
    expect(rows).toHaveLength(1);
    expect(isPiiCiphertext(rows[0]?.phone)).toBe(true);
    expect(await countPendingRebuilds()).toBe(0);
    expect((await getConsumerState(stack.db, MSP_NAME))?.status).toBe("idle");

    const second = await createContact(2);
    await drainDispatcher();
    const afterLive = await readMspRows();
    expect(afterLive).toHaveLength(2);
    expect(isPiiCiphertext(afterLive.find((r) => r.id === second.id)?.phone)).toBe(true);
  });

  test("failing multi-stream rebuild stays queued, keeps old rows and does not mark the consumer dead", async () => {
    const contact = await createContact(1);
    await drainDispatcher();
    const cursorBefore = (await getConsumerState(stack.db, MSP_NAME))?.lastProcessedEventId;
    expect(cursorBefore).toBeGreaterThan(0n);
    armKms();
    failMspApply = true;

    const result = expectRan(await runPiiEventBackfill(stack.db, registryV2));

    expect(result.rebuild?.failed.map((f) => f.projection)).toEqual([MSP_NAME]);
    expect(result.rebuild?.failed[0]?.error).toContain("msp apply failure");
    const pending = (await asRawClient(stack.db).unsafe(
      `SELECT "table_name" FROM "kumiko_pending_rebuilds"`,
    )) as ReadonlyArray<{ table_name: string }>;
    expect(pending.map((p) => p.table_name)).toEqual([MSP_TABLE]);
    const consumerAfter = await getConsumerState(stack.db, MSP_NAME);
    expect(consumerAfter?.status).toBe("idle");
    expect(consumerAfter?.lastProcessedEventId).toBe(cursorBefore);
    expect((await readMspRows()).map((r) => r.phone)).toEqual([contact.phone]);
  });

  test("each run queues under its own migration id, so a peer's re-queue is not cleared by this run", async () => {
    await createContact(1);
    await drainDispatcher();
    armKms();
    failMspApply = true;
    const queuedMigrationId = async (): Promise<string | undefined> => {
      const rows = (await asRawClient(stack.db).unsafe(
        `SELECT "migration_id" FROM "kumiko_pending_rebuilds" WHERE "table_name" = $1`,
        [MSP_TABLE],
      )) as ReadonlyArray<{ migration_id: string }>;
      return rows[0]?.migration_id;
    };

    expectRan(await runPiiEventBackfill(stack.db, registryV2));
    const firstRunId = await queuedMigrationId();
    disarmKms();
    await createContact(2);
    armKms();
    expectRan(await runPiiEventBackfill(stack.db, registryV2));
    const secondRunId = await queuedMigrationId();

    expect(firstRunId).toMatch(/^pii-backfill:[0-9a-f]{12}:.+/);
    expect(secondRunId).toMatch(/^pii-backfill:[0-9a-f]{12}:.+/);
    expect(secondRunId).not.toBe(firstRunId);
  });

  test("a rebuilding run leaves foreign and unmappable queue rows untouched", async () => {
    await createContact(1);
    armKms();
    const raw = asRawClient(stack.db);
    await createPendingRebuildsTable(stack.db);
    await raw.unsafe(
      `INSERT INTO "kumiko_pending_rebuilds" ("table_name", "migration_id") VALUES
         ('read_schema_apply_table', '0042_schema_apply'),
         ('read_unmounted_pii_table', 'pii-backfill:foreign')`,
    );

    const result = expectRan(await runPiiEventBackfill(stack.db, registryV2));

    expect(result.rebuild?.rebuilt.length).toBe(2);
    expect(result.rebuild?.skippedTables).toEqual(["read_unmounted_pii_table"]);
    const rows = (await raw.unsafe(
      `SELECT "table_name" FROM "kumiko_pending_rebuilds" ORDER BY "table_name"`,
    )) as ReadonlyArray<{ table_name: string }>;
    expect(rows.map((r) => r.table_name)).toEqual([
      "read_schema_apply_table",
      "read_unmounted_pii_table",
    ]);
  });

  test("two parallel runs encrypt every value exactly once", async () => {
    const contacts = [];
    for (let i = 1; i <= 5; i++) contacts.push(await createContact(i));
    armKms();

    const results = await Promise.all([
      runPiiEventBackfill(stack.db, registryV2, { batchSize: 2 }),
      runPiiEventBackfill(stack.db, registryV2, { batchSize: 2 }),
    ]);

    for (const result of results) expect(expectRan(result).failures).toEqual([]);
    const events = await readEvents();
    expect(events).toHaveLength(5);
    for (const event of events) {
      const original = requireContact(contacts, event.aggregate_id);
      expect(await decryptField(event.payload["email"], "email")).toBe(original.email);
      expect(await decryptField(event.payload["phone"], "phone")).toBe(original.phone);
    }
  });

  test("KMS outage mid-run: failures reported and recorded, cursor moves past them, run completes; a healthy rerun retries only the failed ids", async () => {
    const contacts = [];
    for (let i = 1; i <= 4; i++) contacts.push(await createContact(i));
    for (const contact of [contacts[0], contacts[2]]) {
      if (!contact) throw new Error("missing contact");
      await saveSnapshot(stack.db, {
        aggregateId: contact.id,
        tenantId: admin.tenantId as TenantId,
        aggregateType: "contact",
        version: 1,
        state: { email: contact.email, phone: contact.phone },
      });
    }
    armKms();
    kms.failAfterKeys = 2;

    const failed = expectRan(await runPiiEventBackfill(stack.db, registryV2));

    expect(failed.failures.length).toBeGreaterThan(0);
    expect(failed.updatedEvents).toBe(2);
    const events = await readEvents();
    expect(events.map((e) => isPiiCiphertext(e.payload["email"]))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(await snapshotCount(contacts[0]?.id ?? "")).toBe(0);
    expect(await snapshotCount(contacts[2]?.id ?? "")).toBe(1);
    const state = await readState();
    expect(state).toHaveLength(1);
    const failedIds = failed.failures.map((f) => f.eventId);
    expect(state[0]?.completed).toBe(true);
    expect(state[0]?.failedEventIds).toEqual(failedIds);
    expect(BigInt(state[0]?.cursor ?? "0")).toBe(BigInt(events[events.length - 1]?.id ?? "0"));

    const stillFailing = expectRan(await runPiiEventBackfill(stack.db, registryV2));
    expect(stillFailing.mode).toBe("catch-up");
    expect(stillFailing.failures.map((f) => f.eventId)).toEqual(failedIds);
    expect((await readState())[0]?.failedEventIds).toEqual(failedIds);

    kms.failAfterKeys = Number.POSITIVE_INFINITY;
    const healed = expectRan(await runPiiEventBackfill(stack.db, registryV2));

    expect(healed.failures).toEqual([]);
    expect(healed.updatedEvents).toBe(failedIds.length);
    expect((await readState())[0]?.failedEventIds).toEqual([]);
    for (const event of await readEvents()) {
      const original = requireContact(contacts, event.aggregate_id);
      expect(await decryptField(event.payload["email"], "email")).toBe(original.email);
      expect(await decryptField(event.payload["phone"], "phone")).toBe(original.phone);
    }
    expect((await readState())[0]?.completed).toBe(true);
  });

  test("catch-up encrypts a plaintext event written later by an old pod", async () => {
    await createContact(1);
    armKms();
    expectRan(await runPiiEventBackfill(stack.db, registryV2));

    disarmKms();
    const late = await createContact(2);
    armKms();
    const result = expectRan(await runPiiEventBackfill(stack.db, registryV2));

    expect(result.mode).toBe("catch-up");
    expect(result.updatedEvents).toBe(1);
    const lateEvent = (await readEvents()).find((e) => e.aggregate_id === late.id);
    expect(await decryptField(lateEvent?.payload["email"], "email")).toBe(late.email);
    expect(await decryptField(lateEvent?.payload["phone"], "phone")).toBe(late.phone);
  });

  test("no KMS configured: skipped, events untouched", async () => {
    await createContact(1);
    const before = await readPayloadsAsText();

    const result = await runPiiEventBackfill(stack.db, registryV2);

    expect(result).toEqual({ status: "skipped", reason: "no_kms" });
    expect(await readPayloadsAsText()).toBe(before);
  });
});

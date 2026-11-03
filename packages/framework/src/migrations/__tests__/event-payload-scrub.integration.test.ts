import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  decryptPiiFieldValues,
  encryptPiiValueForSubject,
  InMemoryKmsAdapter,
  PiiCiphertextCorruptError,
} from "../../crypto/index.ts";
import { PII_ERASED_SENTINEL } from "../../crypto/pii-field-encryption.ts";
import { table as pgTable, uuid as pgUuid } from "../../db/dialect.ts";
import { asRawClient } from "../../db/query.ts";
import { defineFeature } from "../../engine/define-feature.ts";
import {
  createDateField,
  createEntity,
  createNumberField,
  createReferenceField,
  createTextField,
} from "../../engine/factories.ts";
import { append } from "../../event-store/index.ts";
import {
  createSnapshotsTable,
  loadLatestSnapshot,
  saveSnapshot,
} from "../../event-store/snapshot.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { scrubEventPayloadFields } from "../event-payload-scrub.ts";

const contactEntity = createEntity({
  table: "scrub_contacts",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    note: createTextField({ personal: false, reason: "test_fixture" }),
    score: createNumberField({ personal: false, reason: "test_fixture" }),
    birthday: createDateField({ personal: false, reason: "test_fixture" }),
    manager: createReferenceField({ entity: "contact", personal: false, reason: "test_fixture" }),
  },
});

const appointmentEntity = createEntity({
  table: "scrub_appointments",
  fields: { day: createDateField({ required: true, personal: false, reason: "test_fixture" }) },
});

const rebuildProbeTable = pgTable("read_scrub_rebuild_probe", {
  id: pgUuid("id").primaryKey(),
  tenantId: pgUuid("tenant_id").notNull(),
});

// Lets a test make the projection rebuild after a scrub fail.
let failProbeApply = false;

const contactFeature = defineFeature("scrub", (r) => {
  r.multiStreamProjection({
    name: "rebuild-probe",
    table: rebuildProbeTable,
    apply: {
      "contact.created": async () => {
        if (failProbeApply) throw new Error("probe apply failure (test)");
      },
    },
  });
  r.crud("appointment", appointmentEntity, {
    write: { access: { roles: ["User"] } },
    read: { access: { roles: ["User"] } },
  });
  r.crud("contact", contactEntity, {
    write: { access: { roles: ["User"] } },
    read: { access: { roles: ["User"] } },
  });
});

const CREATE = "scrub:write:contact:create";
const UPDATE = "scrub:write:contact:update";
const LIST = "scrub:query:contact:list";
const REASON = "legacy plaintext notes copied from mails before the field was declared personal";

type Contact = { readonly id: string; readonly name: string; readonly note: string | null };

describe("scrubEventPayloadFields", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [contactFeature] });
    await unsafeCreateEntityTable(stack.db, contactEntity);
    await createSnapshotsTable(stack.db);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  async function create(name: string, note: string): Promise<{ id: string; version: number }> {
    const res = await stack.http.writeOk<{ data: { id: string; version: number } }>(
      CREATE,
      { name, note },
      TestUsers.user,
    );
    return res.data;
  }

  async function listedNote(id: string): Promise<string | null | undefined> {
    const page = await stack.http.queryOk<{ rows: readonly Contact[] }>(
      LIST,
      { limit: 50 },
      TestUsers.user,
    );
    return page.rows.find((row) => row.id === id)?.note;
  }

  async function storedPayloads(id: string): Promise<readonly Record<string, unknown>[]> {
    const rows = await asRawClient(stack.db).unsafe<{ payload: Record<string, unknown> }>(
      `SELECT "payload" FROM "kumiko_events" WHERE "aggregate_id" = $1 ORDER BY "id"`,
      [id],
    );
    return rows.map((row) => row.payload);
  }

  async function appendRecordedNote(note: string, type: string): Promise<string> {
    const aggregateId = crypto.randomUUID();
    await append(stack.db, {
      aggregateId,
      aggregateType: "contact",
      tenantId: TestUsers.user.tenantId,
      expectedVersion: 0,
      type,
      payload: { note },
      metadata: { userId: TestUsers.user.id },
    });
    return aggregateId;
  }

  test("erases only the matching values in the events and in the rebuilt read model", async () => {
    const leaked = await create("Ada", "leak: ada@example.com");
    const kept = await create("Bob", "call back on monday");

    const result = await scrubEventPayloadFields(stack.db, stack.registry, {
      eventType: "contact.created",
      fields: ["note"],
      reason: REASON,
      shouldScrub: (value) => typeof value === "string" && value.startsWith("leak"),
    });

    expect(result.scrubbedEvents).toBe(1);
    expect(result.rebuild?.failed).toEqual([]);
    expect((await storedPayloads(leaked.id))[0]?.["note"]).toBe(PII_ERASED_SENTINEL);
    expect(await listedNote(leaked.id)).toBe(PII_ERASED_SENTINEL);
    expect(await listedNote(kept.id)).toBe("call back on monday");
  });

  test("reaches the changes of an update event and leaves its previous values alone", async () => {
    const contact = await create("Cleo", "first note");
    await stack.http.writeOk(
      UPDATE,
      { id: contact.id, version: contact.version, changes: { note: "leak: cleo@example.com" } },
      TestUsers.user,
    );

    await scrubEventPayloadFields(stack.db, stack.registry, {
      eventType: "contact.updated",
      fields: ["note"],
      reason: REASON,
      shouldScrub: (value) => typeof value === "string" && value.startsWith("leak"),
    });

    const updated = (await storedPayloads(contact.id))[1];
    expect(updated?.["changes"]).toMatchObject({ note: PII_ERASED_SENTINEL });
    expect(updated?.["previous"]).toMatchObject({ note: "first note" });
    expect(await listedNote(contact.id)).toBe(PII_ERASED_SENTINEL);
  });

  test("dryRun counts the matches and writes nothing", async () => {
    const contact = await create("Dan", "leak: dan@example.com");

    const result = await scrubEventPayloadFields(stack.db, stack.registry, {
      eventType: "contact.created",
      fields: ["note"],
      reason: REASON,
      dryRun: true,
      shouldScrub: (value) => value === "leak: dan@example.com",
    });

    expect(result.scrubbedEvents).toBe(1);
    expect(result.rebuild).toBeNull();
    expect((await storedPayloads(contact.id))[0]?.["note"]).toBe("leak: dan@example.com");
    expect(await listedNote(contact.id)).toBe("leak: dan@example.com");
  });

  test("a non-text field is nulled so the typed column still rebuilds", async () => {
    const res = await stack.http.writeOk<{ data: { id: string } }>(
      CREATE,
      { name: "Eve", note: "n", score: 42 },
      TestUsers.user,
    );

    const result = await scrubEventPayloadFields(stack.db, stack.registry, {
      eventType: "contact.created",
      fields: ["score"],
      reason: REASON,
      shouldScrub: (value) => value === 42,
    });

    expect(result.scrubbedEvents).toBe(1);
    expect(result.rebuild?.failed).toEqual([]);
    expect((await storedPayloads(res.data.id))[0]?.["score"]).toBeNull();
  });

  test("date and reference values are nulled, not given the text placeholder, so the typed columns still rebuild", async () => {
    const manager = await create("Mia", "n");
    const res = await stack.http.writeOk<{ data: { id: string } }>(
      CREATE,
      { name: "Fay", birthday: "1990-05-17", manager: manager.id },
      TestUsers.user,
    );

    const result = await scrubEventPayloadFields(stack.db, stack.registry, {
      eventType: "contact.created",
      fields: ["birthday", "manager"],
      reason: REASON,
      shouldScrub: (_value, candidate) => candidate.aggregateId === res.data.id,
    });

    expect(result.scrubbedFields).toBe(2);
    expect(result.rebuild?.failed).toEqual([]);
    const created = (await storedPayloads(res.data.id))[0];
    expect(created?.["birthday"]).toBeNull();
    expect(created?.["manager"]).toBeNull();
  });

  test("a required non-text field is refused before any event is touched", async () => {
    expect(() =>
      scrubEventPayloadFields(stack.db, stack.registry, {
        eventType: "appointment.created",
        fields: ["day"],
        reason: REASON,
      }),
    ).toThrow(/required date field/);
  });

  test("a placeholder reason is refused before anything is read", async () => {
    expect(() =>
      scrubEventPayloadFields(stack.db, stack.registry, {
        eventType: "contact.created",
        fields: ["note"],
        reason: "todo",
      }),
    ).toThrow();
  });

  test("pages through the matches across several transactions with a small batchSize", async () => {
    const ids = [
      (await create("Pia", "page-leak one")).id,
      (await create("Quin", "page-leak two")).id,
      (await create("Rex", "page-leak three")).id,
    ];

    const result = await scrubEventPayloadFields(stack.db, stack.registry, {
      eventType: "contact.created",
      fields: ["note"],
      reason: REASON,
      batchSize: 1,
      shouldScrub: (value) => typeof value === "string" && value.startsWith("page-leak"),
    });

    expect(result.scrubbedEvents).toBe(3);
    expect(result.scannedEvents).toBeGreaterThanOrEqual(3);
    for (const id of ids) {
      expect((await storedPayloads(id))[0]?.["note"]).toBe(PII_ERASED_SENTINEL);
    }
  });

  test("drops the snapshots of scrubbed aggregates so the next load cannot serve the old values", async () => {
    const contact = await create("Sam", "leak: sam@example.com");
    await saveSnapshot(stack.db, {
      aggregateId: contact.id,
      tenantId: TestUsers.user.tenantId,
      aggregateType: "contact",
      version: contact.version,
      state: { note: "leak: sam@example.com" },
    });

    const result = await scrubEventPayloadFields(stack.db, stack.registry, {
      eventType: "contact.created",
      fields: ["note"],
      reason: REASON,
      shouldScrub: (_value, candidate) => candidate.aggregateId === contact.id,
    });

    expect(result.deletedSnapshots).toBe(1);
    expect(await loadLatestSnapshot(stack.db, contact.id, TestUsers.user.tenantId)).toBeNull();
  });

  test("an event type that is not a lifecycle event is scrubbed on the whole payload", async () => {
    const aggregateId = await appendRecordedNote("leak: flat payload", "scrub.note-recorded");

    const result = await scrubEventPayloadFields(stack.db, stack.registry, {
      eventType: "scrub.note-recorded",
      fields: ["note"],
      reason: REASON,
    });

    expect(result.scrubbedEvents).toBe(1);
    expect((await storedPayloads(aggregateId))[0]?.["note"]).toBe(PII_ERASED_SENTINEL);
  });

  test("shouldScrub can wipe exactly the values whose ciphertext no longer decrypts", async () => {
    const kms = new InMemoryKmsAdapter();
    const subject = { kind: "user" as const, userId: crypto.randomUUID() };
    const kmsCtx = { requestId: "event-payload-scrub-test" };
    await kms.createKey(subject);
    const intact = await encryptPiiValueForSubject(kms, subject, "secret", kmsCtx, "note");
    const damaged = `${intact.slice(0, -8)}AAAAAAAA`;
    const damagedId = await appendRecordedNote(damaged, "scrub.secret-recorded");
    const intactId = await appendRecordedNote(intact, "scrub.secret-recorded");

    const result = await scrubEventPayloadFields(stack.db, stack.registry, {
      eventType: "scrub.secret-recorded",
      fields: ["note"],
      reason: REASON,
      shouldScrub: async (value) => {
        try {
          await decryptPiiFieldValues({ note: value }, ["note"], kms, kmsCtx);
          return false;
        } catch (e) {
          if (e instanceof PiiCiphertextCorruptError) return true;
          throw e;
        }
      },
    });

    expect(result.scrubbedEvents).toBe(1);
    expect((await storedPayloads(damagedId))[0]?.["note"]).toBe(PII_ERASED_SENTINEL);
    expect((await storedPayloads(intactId))[0]?.["note"]).toBe(intact);
  });

  test("a failing rebuild keeps the scrubbed tables queued under the event-scrub id and reports the failure", async () => {
    const contact = await create("Vic", "leak: vic@example.com");

    failProbeApply = true;
    try {
      const result = await scrubEventPayloadFields(stack.db, stack.registry, {
        eventType: "contact.created",
        fields: ["note"],
        reason: REASON,
        shouldScrub: (_value, candidate) => candidate.aggregateId === contact.id,
      });

      expect(result.scrubbedEvents).toBe(1);
      expect(result.rebuild?.failed.map((failure) => failure.projection)).toContain(
        "scrub:projection:rebuild-probe",
      );
      const queued = await asRawClient(stack.db).unsafe<{ migration_id: string }>(
        `SELECT "migration_id" FROM "kumiko_pending_rebuilds" WHERE "table_name" = 'read_scrub_rebuild_probe'`,
      );
      expect(queued).toHaveLength(1);
      expect(queued[0]?.migration_id.startsWith("event-scrub:")).toBe(true);
    } finally {
      failProbeApply = false;
      await asRawClient(stack.db).unsafe(`DELETE FROM "kumiko_pending_rebuilds"`);
    }
  });
});

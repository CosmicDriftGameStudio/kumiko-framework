import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { PII_ERASED_SENTINEL } from "../../crypto/pii-field-encryption.ts";
import { asRawClient } from "../../db/query.ts";
import { defineFeature } from "../../engine/define-feature.ts";
import {
  createDateField,
  createEntity,
  createNumberField,
  createReferenceField,
  createTextField,
} from "../../engine/factories.ts";
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

const contactFeature = defineFeature("scrub", (r) => {
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
});

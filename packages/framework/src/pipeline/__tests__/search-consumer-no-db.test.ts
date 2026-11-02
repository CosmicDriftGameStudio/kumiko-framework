import { describe, expect, test } from "bun:test";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import type { TenantId } from "../../engine/types/identifiers.ts";
import type { StoredEvent } from "../../event-store/index.ts";
import { createInMemorySearchAdapter } from "../../search/in-memory-adapter.ts";
import type { SearchAdapter } from "../../search/types.ts";
import { createSearchEventConsumer } from "../system-hooks.ts";

const noteEntity = createEntity({
  table: "no_db_search_notes",
  fields: {
    label: createTextField({
      personal: false,
      reason: "test_fixture",
      required: true,
      maxLength: 100,
      searchable: true,
    }),
  },
});

function removalRecordingAdapter(removed: string[]): SearchAdapter {
  return {
    ...createInMemorySearchAdapter(),
    remove: async (_tenantId, _entityType, entityId) => {
      removed.push(String(entityId));
    },
    removeBatch: async (_tenantId, items) => {
      for (const item of items) removed.push(String(item.entityId));
    },
  };
}

function eventOf(id: string, type: string, tenantId: TenantId, aggregateId: string): StoredEvent {
  return {
    id,
    aggregateId,
    aggregateType: "note",
    tenantId,
    version: 2,
    type,
    eventVersion: 1,
    payload: {},
    metadata: { userId: "test" },
    createdAt: Temporal.Instant.fromEpochMilliseconds(0),
    createdBy: "test",
  };
}

const noteRegistry = () =>
  createRegistry([
    defineFeature("nodb", (r) => {
      r.entity({ name: "note", ...noteEntity });
    }),
  ]);

describe("search consumer without a db on its context", () => {
  test("a named event fails for retry instead of removing the index entry", async () => {
    const removed: string[] = [];
    const consumer = createSearchEventConsumer(removalRecordingAdapter(removed), noteRegistry());
    const event = eventOf(
      "1",
      "nodb:event:note:relabeled",
      "00000000-0000-4000-8000-000000000001" as TenantId,
      crypto.randomUUID(),
    );

    await expect(
      consumer.handler(event, {} as Parameters<typeof consumer.handler>[1]),
    ).rejects.toThrow("no db on the consumer context");
    expect(removed).toEqual([]);
  });

  test("a batch holds the tenant whose event cannot be resolved and still serves the others", async () => {
    const removed: string[] = [];
    const consumer = createSearchEventConsumer(removalRecordingAdapter(removed), noteRegistry());
    const tenantWithFailingRead = "00000000-0000-4000-8000-000000000001" as TenantId;
    const healthyTenant = "00000000-0000-4000-8000-000000000002" as TenantId;
    const healthyNoteId = crypto.randomUUID();
    const held: { eventIds: readonly string[]; reason: string }[] = [];

    await consumer.batchHandler?.(
      [
        eventOf("1", "nodb:event:note:relabeled", tenantWithFailingRead, crypto.randomUUID()),
        eventOf("2", "note.deleted", healthyTenant, healthyNoteId),
      ],
      {} as Parameters<typeof consumer.handler>[1],
      { holdForRetry: (eventIds, reason) => held.push({ eventIds, reason }) },
    );

    expect(removed).toEqual([healthyNoteId]);
    expect(held.map((h) => h.eventIds)).toEqual([["1"]]);
    expect(held[0]?.reason).toContain(tenantWithFailingRead);
    expect(held[0]?.reason).toContain("no db on the consumer context");
  });

  test("a later delete waits behind an unresolved update of the same tenant, so the retry cannot resurrect the entry", async () => {
    const removed: string[] = [];
    const consumer = createSearchEventConsumer(removalRecordingAdapter(removed), noteRegistry());
    const tenantId = "00000000-0000-4000-8000-000000000001" as TenantId;
    const noteId = crypto.randomUUID();
    const held: { eventIds: readonly string[]; reason: string }[] = [];

    await consumer.batchHandler?.(
      [
        eventOf("1", "nodb:event:note:relabeled", tenantId, noteId),
        eventOf("2", "note.deleted", tenantId, noteId),
      ],
      {} as Parameters<typeof consumer.handler>[1],
      { holdForRetry: (eventIds, reason) => held.push({ eventIds, reason }) },
    );

    expect(removed).toEqual([]);
    expect(held.map((h) => h.eventIds)).toEqual([["1", "2"]]);
  });
});

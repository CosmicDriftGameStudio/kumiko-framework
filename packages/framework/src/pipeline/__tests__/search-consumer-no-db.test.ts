import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
} from "../../engine/index.js";
import type { TenantId } from "../../engine/types/identifiers.js";
import type { StoredEvent } from "../../event-store/index.js";
import type { SearchAdapter } from "../../search/types.js";
import { createSearchEventConsumer } from "../system-hooks.js";

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

describe("search consumer without a db on its context", () => {
  test("a named event fails for retry instead of removing the index entry", async () => {
    const removed: string[] = [];
    const adapter = {
      remove: async (_tenantId: TenantId, _entityType: string, entityId: string) => {
        removed.push(entityId);
      },
    } as unknown as SearchAdapter; // @cast-boundary test stub — only remove() is reachable on this path
    const registry = createRegistry([
      defineFeature("nodb", (r) => {
        r.entity("note", noteEntity);
      }),
    ]);
    const consumer = createSearchEventConsumer(adapter, registry);
    const event = {
      id: "1",
      aggregateId: crypto.randomUUID(),
      aggregateType: "note",
      tenantId: "00000000-0000-4000-8000-000000000001" as TenantId,
      version: 2,
      type: "nodb:event:note:relabeled",
      eventVersion: 1,
      payload: {},
    } as unknown as StoredEvent; // @cast-boundary test stub — only the fields the consumer reads

    await expect(
      consumer.handler(event, {} as Parameters<typeof consumer.handler>[1]),
    ).rejects.toThrow("no db on the consumer context");
    expect(removed).toEqual([]);
  });
});

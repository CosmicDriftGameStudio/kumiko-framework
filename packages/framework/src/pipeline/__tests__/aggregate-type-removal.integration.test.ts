// Whole-type removal (`kumiko events prune`): the claims pinned here are that exactly the named
// types leave the log with everything per-aggregate hanging off them, that a kept type stays
// byte-identical, and that the projection rebuild `schema apply` runs is green afterwards even
// when old events of a removed type violate a NOT NULL column on replay.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createRegistry } from "../../engine/registry.ts";
import { rebuildProjectionOrMultiStream } from "../../migrations/index.ts";
import { generateId } from "../../utils/index.ts";
import { removeAggregateTypes } from "../aggregate-type-removal.ts";
import {
  count as countIn,
  createFixtureTables,
  FILE,
  feature,
  KEPT,
  mixedFeature,
  mixedStreamFeature,
  RELEASE,
  seedFixture,
  sql as sqlIn,
} from "./aggregate-type-removal-fixture.ts";

const DB_NAME = `kumiko_evprune_${generateId().slice(-8)}`;

let stack: TestStack;

const sql = <T>(text: string) => sqlIn<T>(stack, text);
const count = (table: string, where?: string) => countIn(stack, table, where);

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature], dbName: DB_NAME });
  await createFixtureTables(stack);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await seedFixture(stack);
});

const removed = { types: [RELEASE, FILE] };

describe("removeAggregateTypes — dry run", () => {
  test("reports counts per type and deletes nothing", async () => {
    const eventsBefore = await count("kumiko_events");
    const result = await removeAggregateTypes(stack.db, stack.registry, {
      ...removed,
      apply: false,
    });

    expect(result.deleted).toBeUndefined();
    expect(result.plan.stats).toEqual([
      { aggregateType: RELEASE, events: 2, aggregates: 2, tenants: 1 },
      { aggregateType: FILE, events: 2, aggregates: 2, tenants: 1 },
    ]);
    expect(await count("kumiko_events")).toBe(eventsBefore);
    expect(await count("read_evprune_release")).toBe(1);
    expect(await count("kumiko_snapshots")).toBe(3);
  });
});

describe("removeAggregateTypes — apply", () => {
  test("removes exactly the named types and leaves the kept type untouched", async () => {
    const keptEventsBefore = await sql(
      `SELECT * FROM kumiko_events WHERE aggregate_type = '${KEPT}' ORDER BY id`,
    );
    const keptRowsBefore = await sql(`SELECT * FROM read_evprune_kept ORDER BY id`);

    const result = await removeAggregateTypes(stack.db, stack.registry, {
      ...removed,
      apply: true,
    });

    expect(result.deleted).toMatchObject({
      events: 4,
      snapshots: 2,
      archivedStreams: 1,
      upcasterDeadLetters: 1,
      rebuildDeadLetters: 1,
    });
    expect(await count("kumiko_events", `aggregate_type IN ('${RELEASE}', '${FILE}')`)).toBe(0);
    expect(await count("kumiko_snapshots", `aggregate_type IN ('${RELEASE}', '${FILE}')`)).toBe(0);
    expect(await count("kumiko_archived_streams")).toBe(0);
    expect(await count("kumiko_upcaster_dead_letters")).toBe(0);
    expect(await count("kumiko_rebuild_dead_letters")).toBe(0);
    expect(await count("read_evprune_release")).toBe(0);
    expect(await count("read_evprune_file")).toBe(0);

    expect(
      await sql(`SELECT * FROM kumiko_events WHERE aggregate_type = '${KEPT}' ORDER BY id`),
    ).toEqual(keptEventsBefore);
    expect(await sql(`SELECT * FROM read_evprune_kept ORDER BY id`)).toEqual(keptRowsBefore);
    expect(await count("kumiko_snapshots", `aggregate_type = '${KEPT}'`)).toBe(1);
  });

  test("a rebuild over the registry fails on the legacy event before and passes after", async () => {
    const rebuildAll = async () => {
      for (const name of stack.registry.getAllProjections().keys()) {
        await rebuildProjectionOrMultiStream(name, { db: stack.db, registry: stack.registry });
      }
    };
    await expect(rebuildAll()).rejects.toThrow(/null value|not-null|app_id/i);

    await removeAggregateTypes(stack.db, stack.registry, { ...removed, apply: true });

    await rebuildAll();
    expect(await count("read_evprune_kept")).toBe(2);
    expect(await count("read_evprune_release")).toBe(0);
  });

  test("refuses, deleting nothing, when a projection mixes removed and other types", async () => {
    const mixedRegistry = createRegistry([feature, mixedFeature]);
    await expect(
      removeAggregateTypes(stack.db, mixedRegistry, { types: ["mixed-a"], apply: true }),
    ).rejects.toThrow(/Refusing.*mixed-both/);
    expect(await count("kumiko_events")).toBe(6);
  });

  test("refuses when a multi-stream projection also reads an event without an aggregate type", async () => {
    const registry = createRegistry([feature, mixedStreamFeature]);
    await expect(
      removeAggregateTypes(stack.db, registry, { types: ["msp-a"], apply: true }),
    ).rejects.toThrow(/Refusing.*msp-both/);
    expect(await count("kumiko_events")).toBe(6);
  });
});

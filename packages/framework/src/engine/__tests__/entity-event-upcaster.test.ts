import { describe, expect, test } from "bun:test";
import { effectiveSnapshotGeneration } from "../../event-store/snapshot.js";
import { createEntity, createRegistry, createTextField, defineFeature } from "../index.js";
import { adaptRowTransformToPayload } from "../registry-validate.js";
import type { EntityEventMigration, EventUpcastCtx } from "../types/index.js";

const ctx = {} as EventUpcastCtx;
const textField = createTextField({ personal: false, reason: "test_fixture", required: false });

const upperName: EntityEventMigration = {
  fromVersion: 1,
  toVersion: 2,
  transform: (fields) =>
    "name" in fields ? { ...fields, name: String(fields["name"]).toUpperCase() } : fields,
};

function registryWith(def: {
  eventVersion?: number;
  eventMigrations?: readonly EntityEventMigration[];
}) {
  const entity = createEntity({ table: "read_ev_things", fields: { name: textField }, ...def });
  return createRegistry([defineFeature("evtest", (r) => r.entity("thing", entity))]);
}

describe("entity event upcaster registration", () => {
  test("registers a chain for every lifecycle verb", () => {
    const upcasters = registryWith({
      eventVersion: 2,
      eventMigrations: [upperName],
    }).getEventUpcasters();
    for (const verb of ["created", "updated", "deleted", "restored", "forgotten"]) {
      expect(upcasters.get(`thing.${verb}`)?.currentVersion).toBe(2);
    }
  });

  test("boot fails on a gap in the chain", () => {
    expect(() =>
      registryWith({
        eventVersion: 3,
        eventMigrations: [upperName],
      }),
    ).toThrow(/thing.*v2 → v3/);
  });

  test("boot fails on eventMigrations without eventVersion > 1", () => {
    expect(() => registryWith({ eventMigrations: [upperName] })).toThrow(/no eventVersion > 1/);
  });

  test("boot fails on a migration that skips versions or exceeds eventVersion", () => {
    expect(() =>
      registryWith({ eventVersion: 2, eventMigrations: [{ ...upperName, toVersion: 3 }] }),
    ).toThrow(/advance by exactly one/);
  });

  test("entities without eventVersion register no upcaster", () => {
    expect(registryWith({}).getEventUpcasters().has("thing.created")).toBe(false);
  });
});

describe("adaptRowTransformToPayload", () => {
  const rename = (fields: Readonly<Record<string, unknown>>) =>
    "old" in fields ? { new: fields["old"] } : fields;

  test("updated transforms changes and previous, leaves other keys", async () => {
    const adapted = adaptRowTransformToPayload("updated", rename);
    const result = await adapted(
      { changes: { old: 1 }, previous: { old: 0 }, other: { old: 9 } },
      ctx,
    );
    expect(result).toEqual({ changes: { new: 1 }, previous: { new: 0 }, other: { old: 9 } });
  });

  test("updated tolerates absent or non-object parts", async () => {
    const adapted = adaptRowTransformToPayload("updated", rename);
    expect(await adapted({ changes: { old: 1 }, previous: null }, ctx)).toEqual({
      changes: { new: 1 },
      previous: null,
    });
  });

  test("created transforms the whole payload", async () => {
    const adapted = adaptRowTransformToPayload("created", rename);
    expect(await adapted({ old: 1 }, ctx)).toEqual({ new: 1 });
  });

  test("deleted transforms previous only", async () => {
    const adapted = adaptRowTransformToPayload("deleted", rename);
    expect(await adapted({ previous: { old: 1 } }, ctx)).toEqual({ previous: { new: 1 } });
  });
});

describe("effectiveSnapshotGeneration", () => {
  test("eventVersion 1 or undefined keeps the caller generation", () => {
    expect(effectiveSnapshotGeneration(4, 1)).toBe(4);
    expect(effectiveSnapshotGeneration(4, undefined)).toBe(4);
  });

  test("higher eventVersions yield distinct generations that never collide with caller values", () => {
    const seen = new Set<number>();
    for (const caller of [1, 2, 3]) {
      for (const ev of [1, 2, 3]) seen.add(effectiveSnapshotGeneration(caller, ev));
    }
    expect(seen.size).toBe(9);
    expect(effectiveSnapshotGeneration(1, 2)).toBeLessThan(0);
  });
});

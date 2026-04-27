// Quarantine-Policy für fehlerhafte Upcaster.
//
// Die throw-Policy ist bereits in upcaster.integration.ts getestet. Hier:
//   - quarantine schreibt eine dead-letter-Row
//   - der Event wird aus der Result-Liste entfernt
//   - die throw-Policy bleibt unverändert (Regression-Guard)
//   - listDeadLetters filtert per eventType

import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { createTestDb, type TestDb } from "../../stack";
import type { StoredEvent } from "../event-store";
import { createEventsTable, eventsTable } from "../events-schema";
import { type EventUpcasters, makeUpcastCtx, upcastStoredEvents } from "../upcaster";
import {
  createUpcasterDeadLetterTable,
  listDeadLetters,
  upcasterDeadLetterTable,
} from "../upcaster-dead-letter";

let testDb: TestDb;

const TENANT_ID = "00000000-0000-4000-8000-0000000000aa";

function makeEvent(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id: "1",
    aggregateId: "agg-1",
    aggregateType: "probe",
    tenantId: TENANT_ID as StoredEvent["tenantId"],
    version: 1,
    type: "probe.broken",
    eventVersion: 1,
    payload: { legacy: "value" },
    metadata: {} as StoredEvent["metadata"],
    createdAt: new Date(0) as unknown as StoredEvent["createdAt"],
    createdBy: "system",
    ...overrides,
  };
}

// Upcaster chain that deliberately throws at v1→v2. Used for the
// quarantine path; the throw case rides the same wiring but with the
// default policy.
const failingUpcasters: EventUpcasters = new Map([
  [
    "probe.broken",
    {
      currentVersion: 2,
      chain: new Map([
        [
          1,
          async () => {
            throw new Error("payload malformed: missing required field");
          },
        ],
      ]),
    },
  ],
]);

const passthroughUpcasters: EventUpcasters = new Map([
  [
    "probe.ok",
    {
      currentVersion: 2,
      chain: new Map([
        [1, async (payload) => ({ ...(payload as Record<string, unknown>), migrated: true })],
      ]),
    },
  ],
]);

beforeAll(async () => {
  testDb = await createTestDb();
  await createEventsTable(testDb.db);
  await createUpcasterDeadLetterTable(testDb.db);
});

afterAll(async () => {
  await testDb.cleanup();
});

afterEach(async () => {
  await testDb.db.delete(upcasterDeadLetterTable);
  await testDb.db.delete(eventsTable);
});

describe("upcaster error-policy: throw (default)", () => {
  test("failing transform propagates the thrown error", async () => {
    const events = [makeEvent()];
    await expect(
      upcastStoredEvents(events, failingUpcasters, makeUpcastCtx(testDb.db, TENANT_ID)),
    ).rejects.toThrow(/payload malformed/);
  });

  test("failing transform writes NO dead-letter row", async () => {
    const events = [makeEvent()];
    await upcastStoredEvents(events, failingUpcasters, makeUpcastCtx(testDb.db, TENANT_ID)).catch(
      () => {},
    );
    const rows = await listDeadLetters(testDb.db);
    expect(rows).toHaveLength(0);
  });
});

describe("upcaster error-policy: quarantine", () => {
  test("failing transform writes a dead-letter row and is removed from the result list", async () => {
    const ok = makeEvent({
      id: "10",
      type: "probe.ok",
      payload: { value: 42 },
      eventVersion: 1,
    });
    const broken = makeEvent({ id: "11", type: "probe.broken" });

    // Combined upcaster map — real callers have both registered together.
    const combined: EventUpcasters = new Map([
      ...failingUpcasters.entries(),
      ...passthroughUpcasters.entries(),
    ]);

    const result = await upcastStoredEvents(
      [ok, broken],
      combined,
      makeUpcastCtx(testDb.db, TENANT_ID),
      { errorPolicy: "quarantine" },
    );

    // Only the ok event survives; broken landed in dead-letters.
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("10");
    expect(result[0]?.eventVersion).toBe(2);
    expect((result[0]?.payload as { migrated?: boolean }).migrated).toBe(true);

    const dl = await listDeadLetters(testDb.db);
    expect(dl).toHaveLength(1);
    expect(dl[0]).toMatchObject({
      eventId: "11",
      aggregateId: "agg-1",
      aggregateType: "probe",
      eventType: "probe.broken",
      fromVersion: 1,
      targetVersion: 2,
    });
    expect(dl[0]?.errorMessage).toContain("payload malformed");
    expect(dl[0]?.originalPayload).toEqual({ legacy: "value" });
  });

  test("listDeadLetters filters by eventType", async () => {
    await upcastStoredEvents(
      [
        makeEvent({ id: "20", type: "probe.broken" }),
        makeEvent({ id: "21", type: "probe.broken" }),
      ],
      failingUpcasters,
      makeUpcastCtx(testDb.db, TENANT_ID),
      { errorPolicy: "quarantine" },
    );

    // Drop one directly to add noise of a different type.
    await testDb.db.insert(upcasterDeadLetterTable).values({
      eventId: "99",
      tenantId: TENANT_ID,
      aggregateId: "other",
      aggregateType: "other",
      eventType: "other.broken",
      fromVersion: 1,
      targetVersion: 2,
      errorMessage: "unrelated",
      originalPayload: {},
    });

    const probeOnly = await listDeadLetters(testDb.db, { eventType: "probe.broken" });
    expect(probeOnly).toHaveLength(2);
    expect(probeOnly.every((r) => r.eventType === "probe.broken")).toBe(true);

    const all = await listDeadLetters(testDb.db);
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  test("same event quarantined twice inserts two rows (retry-across-deploys visibility)", async () => {
    const broken = makeEvent({ id: "30", type: "probe.broken" });

    await upcastStoredEvents([broken], failingUpcasters, makeUpcastCtx(testDb.db, TENANT_ID), {
      errorPolicy: "quarantine",
    });
    await upcastStoredEvents([broken], failingUpcasters, makeUpcastCtx(testDb.db, TENANT_ID), {
      errorPolicy: "quarantine",
    });

    const rows = await testDb.db
      .select({ c: sql<number>`count(*)::int` })
      .from(upcasterDeadLetterTable)
      .where(eq(upcasterDeadLetterTable.eventId, "30"));
    expect(rows[0]?.c).toBe(2);
  });
});

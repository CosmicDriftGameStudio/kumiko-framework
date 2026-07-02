// Coverage-Lücke (unit + integration): toStoredEvent wird auf dem Event-Load-
// Pfad ausgeführt, aber kein Test asserted das Mapping. Regression-Guard: ein
// fallengelassenes/falsches Feld wäre stiller Datenverlust beim Replay.

import { describe, expect, test } from "bun:test";
import type { TenantId } from "../../engine/types";
import type { EventMetadata, StoredEvent } from "../event-store";
import { toStoredEvent } from "../row-to-stored-event";

const metadata: EventMetadata = {
  userId: "user-1",
  requestId: "req-1",
  correlationId: "corr-1",
  causationId: "cause-1",
};

const row = {
  id: 42n,
  aggregateId: "agg-1",
  aggregateType: "credit",
  tenantId: "tenant-1" as TenantId,
  version: 3,
  type: "credit.created",
  eventVersion: 2,
  payload: { amount: 100 },
  metadata,
  createdAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
  createdBy: "user-1",
};

describe("toStoredEvent", () => {
  test("stringifiziert die bigint-id", () => {
    expect(toStoredEvent(row).id).toBe("42");
  });

  test("mappt jedes Feld werttreu durch", () => {
    const ev = toStoredEvent(row);
    expect(ev.aggregateId).toBe("agg-1");
    expect(ev.aggregateType).toBe("credit");
    expect(ev.tenantId).toBe("tenant-1" as TenantId);
    expect(ev.version).toBe(3);
    expect(ev.type).toBe("credit.created");
    expect(ev.eventVersion).toBe(2);
    expect(ev.payload).toEqual({ amount: 100 });
    expect(ev.metadata).toBe(metadata);
    expect(ev.createdAt).toBe(row.createdAt);
    expect(ev.createdBy).toBe("user-1");
  });

  test("Feld-Vollständigkeit: das Mapping deckt genau die StoredEvent-Keys ab", () => {
    // Guards required fields staying in sync with StoredEvent (event-store.ts);
    // optional fields consistently omitted on both sides must be added manually.
    const expectedKeys: ReadonlyArray<keyof StoredEvent> = [
      "id",
      "aggregateId",
      "aggregateType",
      "tenantId",
      "version",
      "type",
      "eventVersion",
      "payload",
      "metadata",
      "createdAt",
      "createdBy",
    ];
    expect(Object.keys(toStoredEvent(row)).sort()).toEqual([...expectedKeys].sort());
  });
});

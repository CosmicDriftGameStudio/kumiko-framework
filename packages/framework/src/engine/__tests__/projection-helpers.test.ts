import { describe, expect, test, vi } from "vitest";
import type { StoredEvent } from "../../event-store/event-store";
import { setFields } from "../projection-helpers";
import type { ProjectionTable } from "../types/projection";

// Minimal fake table: only the `id` column is needed for setFields, and
// setFields only hands it to `eq()` — no actual SQL runs in the unit test.
// The cast mirrors ProjectionTable's deliberate erasure: the framework
// doesn't know user table shapes at compile time, so real Drizzle tables
// go through the same `any`-ish generic parameter.
const fakeIdCol = { name: "id" };
const fakeTable = { id: fakeIdCol, __name: "fake_table" } as unknown as ProjectionTable;

function makeFakeEvent(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id: "evt-1",
    aggregateId: "agg-42",
    aggregateType: "invoice",
    // biome-ignore lint/suspicious/noExplicitAny: test shim — TenantId is a branded string and we don't exercise that branch here.
    tenantId: "tenant-1" as any,
    version: 1,
    type: "invoice.sent",
    eventVersion: 1,
    payload: {},
    metadata: { userId: "u-1", requestId: "r-1" },
    createdAt: Temporal.Instant.from("2026-04-17T00:00:00Z"),
    createdBy: "u-1",
    ...overrides,
  };
}

// Drizzle's tx.update(...).set(...).where(...) chain — capture each step.
function makeFakeTx() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return { fakeTx: { update } as never, update, set, where };
}

describe("setFields", () => {
  test("returns an apply fn that UPDATEs the passed fields WHERE id = aggregateId", async () => {
    const apply = setFields(fakeTable, { status: "sent" });
    const { fakeTx, update, set } = makeFakeTx();
    await apply(makeFakeEvent(), fakeTx);
    expect(update).toHaveBeenCalledWith(fakeTable);
    expect(set).toHaveBeenCalledWith({ status: "sent" });
  });

  test("fields as a function receives the event and returns the field values", async () => {
    const apply = setFields(fakeTable, (event) => ({
      status: (event.payload as { newStatus: string }).newStatus,
    }));
    const { fakeTx, set } = makeFakeTx();
    await apply(makeFakeEvent({ payload: { newStatus: "cancelled" } }), fakeTx);
    expect(set).toHaveBeenCalledWith({ status: "cancelled" });
  });

  test("throws at construction time when the table has no 'id' column", () => {
    const tableWithoutId = { __name: "weird_table" } as unknown as ProjectionTable;
    expect(() => setFields(tableWithoutId, { status: "x" })).toThrow(/no 'id' column/);
  });
});

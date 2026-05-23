import { describe, expect, test, vi } from "vitest";
import type { StoredEvent } from "../../event-store/event-store";
import { setFields } from "../projection-helpers";
import type { ProjectionTable } from "../types/projection";

// Minimal fake table: only the `id` column is needed for setFields, plus
// the drizzle:Name + drizzle:Columns symbols that bun-db introspects for
// table-name + column-mapping. We don't run real SQL — unsafe() is mocked.
const fakeIdCol = { name: "id" };
const fakeTable = Object.assign(
  { id: fakeIdCol },
  {
    [Symbol.for("drizzle:Name")]: "fake_table",
    [Symbol.for("drizzle:Columns")]: { id: fakeIdCol },
  },
) as unknown as ProjectionTable;

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

// bun-db path: setFields calls updateMany(tx, table, set, where) which lands
// on asRawClient(tx).unsafe(sqlText, params). Capture the SQL + params.
function makeFakeTx() {
  const unsafe = vi.fn(async (_sqlText: string, _params: unknown[]) => [] as unknown[]);
  const fakeTx = { unsafe, begin: vi.fn() } as never;
  return { fakeTx, unsafe };
}

describe("setFields", () => {
  test("returns an apply fn that UPDATEs the passed fields WHERE id = aggregateId", async () => {
    const apply = setFields(fakeTable, { status: "sent" });
    const { fakeTx, unsafe } = makeFakeTx();
    await apply(makeFakeEvent(), fakeTx);
    expect(unsafe).toHaveBeenCalledOnce();
    const [sqlText, params] = unsafe.mock.calls[0]!;
    expect(sqlText).toMatch(/UPDATE "fake_table" SET "status" = \$1.*WHERE "id" = \$2/);
    expect(params).toEqual(["sent", "agg-42"]);
  });

  test("fields as a function receives the event and returns the field values", async () => {
    const apply = setFields(fakeTable, (event) => ({
      status: (event.payload as { newStatus: string }).newStatus,
    }));
    const { fakeTx, unsafe } = makeFakeTx();
    await apply(makeFakeEvent({ payload: { newStatus: "cancelled" } }), fakeTx);
    expect(unsafe).toHaveBeenCalledOnce();
    const [, params] = unsafe.mock.calls[0]!;
    expect(params).toEqual(["cancelled", "agg-42"]);
  });

  test("throws at construction time when the table has no 'id' column", () => {
    const tableWithoutId = { __name: "weird_table" } as unknown as ProjectionTable;
    expect(() => setFields(tableWithoutId, { status: "x" })).toThrow(/no 'id' column/);
  });
});

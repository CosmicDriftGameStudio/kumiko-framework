import type { SQL } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStep } from "../define-step";
import { buildReadFindManyStep } from "../steps/read-find-many";
import { buildReadFindOneStep } from "../steps/read-find-one";
import type { PipelineCtx } from "../types/step";

const testTable = pgTable("test_read", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  label: text("label"),
});

class MockQuery {
  rows: Record<string, unknown>[] = [];
  where = vi.fn(() => this);
  limit = vi.fn(() => this);
  // biome-ignore lint/suspicious/noThenProperty: mock query builder is intentionally thenable so await resolves rows
  then: Promise<Record<string, unknown>[]>["then"];

  constructor(rows?: Record<string, unknown>[]) {
    if (rows) this.rows = rows;
    const promise = Promise.resolve(this.rows);
    // biome-ignore lint/suspicious/noThenProperty: see above
    this.then = promise.then.bind(promise);
  }
}

const mockDb = { select: vi.fn(() => ({ from: vi.fn(() => new MockQuery([])) })) };

const mockCtx = {
  db: mockDb,
  event: { type: "test", payload: {} },
  steps: {},
  scope: {},
} as unknown as PipelineCtx;

describe("buildReadFindOneStep", () => {
  it("returns a StepInstance with kind read.findOne", () => {
    const step = buildReadFindOneStep("myLookup", {
      table: testTable,
      where: undefined as unknown as SQL,
    });
    expect(step.kind).toBe("read.findOne");
    expect((step.args as { name: string }).name).toBe("myLookup");
  });

  it("stores the result key from the name arg", () => {
    const step = buildReadFindOneStep("lookupResult", {
      table: testTable,
      where: undefined as unknown as SQL,
    });
    const def = getStep("read.findOne");
    expect(def?.resultKey?.(step.args as { name: string })).toBe("lookupResult");
  });
});

describe("read.findOne run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no row is found", async () => {
    const stepDef = getStep("read.findOne");
    const query = new MockQuery([]);
    mockDb.select.mockReturnValue({ from: vi.fn().mockReturnValue(query) });

    const result = await stepDef!.run(
      { name: "lookup", table: testTable, where: undefined as unknown as SQL },
      mockCtx,
    );

    expect(result).toBeNull();
  });

  it("returns the first row when found", async () => {
    const stepDef = getStep("read.findOne");
    const row = { id: "abc", tenantId: "t1", label: "hello" };
    const query = new MockQuery([row]);
    mockDb.select.mockReturnValue({ from: vi.fn().mockReturnValue(query) });

    const result = await stepDef!.run(
      { name: "lookup", table: testTable, where: undefined as unknown as SQL },
      mockCtx,
    );

    expect(result).toEqual(row);
  });

  it("resolves a function where-clause before querying", async () => {
    const stepDef = getStep("read.findOne");
    const whereFn = vi.fn(() => "dynamic where" as unknown as SQL);
    const query = new MockQuery([]);
    mockDb.select.mockReturnValue({ from: vi.fn().mockReturnValue(query) });

    await stepDef!.run({ name: "lookup", table: testTable, where: whereFn }, mockCtx);

    expect(whereFn).toHaveBeenCalledWith(mockCtx);
    expect(query.where).toHaveBeenCalledWith("dynamic where");
  });
});

describe("buildReadFindManyStep", () => {
  it("returns a StepInstance with kind read.findMany", () => {
    const step = buildReadFindManyStep("myList", { table: testTable });
    expect(step.kind).toBe("read.findMany");
    expect((step.args as { name: string }).name).toBe("myList");
  });

  it("accepts an optional limit", () => {
    const step = buildReadFindManyStep("myList", { table: testTable, limit: 10 });
    expect((step.args as { limit: number }).limit).toBe(10);
  });
});

describe("read.findMany run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty array when no rows exist", async () => {
    const stepDef = getStep("read.findMany");
    const query = new MockQuery([]);
    mockDb.select.mockReturnValue({ from: vi.fn().mockReturnValue(query) });

    const result = await stepDef!.run({ name: "list", table: testTable }, mockCtx);

    expect(result).toEqual([]);
  });

  it("applies the limit when specified", async () => {
    const stepDef = getStep("read.findMany");
    const rows = [{ id: "a" }, { id: "b" }];
    const query = new MockQuery(rows);
    mockDb.select.mockReturnValue({ from: vi.fn().mockReturnValue(query) });

    await stepDef!.run({ name: "list", table: testTable, limit: 2 }, mockCtx);

    expect(query.limit).toHaveBeenCalledWith(2);
  });
});

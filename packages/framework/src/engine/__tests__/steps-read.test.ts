import { beforeEach, describe, expect, it, vi } from "vitest";
import { table, text, uuid } from "../../db/dialect";
import { getStep } from "../define-step";
import { buildReadFindManyStep } from "../steps/read-find-many";
import { buildReadFindOneStep } from "../steps/read-find-one";
import type { PipelineCtx } from "../types/step";

const testTable = table("test_read", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  label: text("label"),
});

// bun-db path: read-find-many/one call selectMany(ctx.db.raw, table, where, opts)
// which goes through asRawClient(ctx.db.raw).unsafe(sqlText, params).
// Mock the .unsafe() return value to feed back rows.
const unsafeMock = vi.fn(
  async (_sqlText: string, _params: unknown[]): Promise<Record<string, unknown>[]> => [],
);
const rawDb = { unsafe: unsafeMock, begin: vi.fn() };
const ctxDb = { raw: rawDb };

const mockCtx = {
  db: ctxDb,
  event: { type: "test", payload: {} },
  steps: {},
  scope: {},
} as unknown as PipelineCtx;

describe("buildReadFindOneStep", () => {
  it("returns a StepInstance with kind read.findOne", () => {
    const step = buildReadFindOneStep("myLookup", {
      table: testTable,
      where: { id: "x" },
    });
    expect(step.kind).toBe("read.findOne");
    expect((step.args as { name: string }).name).toBe("myLookup");
  });

  it("stores the result key from the name arg", () => {
    const step = buildReadFindOneStep("lookupResult", {
      table: testTable,
      where: { id: "x" },
    });
    const def = getStep("read.findOne");
    expect(def?.resultKey?.(step.args as { name: string })).toBe("lookupResult");
  });
});

describe("read.findOne run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    unsafeMock.mockResolvedValue([]);
  });

  it("returns null when no row is found", async () => {
    const stepDef = getStep("read.findOne");
    unsafeMock.mockResolvedValueOnce([]);

    const result = await stepDef!.run(
      { name: "lookup", table: testTable, where: { id: "x" } },
      mockCtx,
    );

    expect(result).toBeNull();
  });

  it("returns the first row when found", async () => {
    const stepDef = getStep("read.findOne");
    const row = { id: "abc", tenantId: "t1", label: "hello" };
    unsafeMock.mockResolvedValueOnce([row]);

    const result = await stepDef!.run(
      { name: "lookup", table: testTable, where: { id: "abc" } },
      mockCtx,
    );

    expect(result).toEqual(row);
  });

  it("resolves a function where-clause before querying", async () => {
    const stepDef = getStep("read.findOne");
    const whereFn = vi.fn(() => ({ tenantId: "dyn-tenant" }));
    unsafeMock.mockResolvedValueOnce([]);

    await stepDef!.run({ name: "lookup", table: testTable, where: whereFn }, mockCtx);

    expect(whereFn).toHaveBeenCalledWith(mockCtx);
    expect(unsafeMock).toHaveBeenCalledOnce();
    const [sqlText, params] = unsafeMock.mock.calls[0]!;
    expect(sqlText).toMatch(/SELECT \* FROM "test_read"/);
    expect(sqlText).toMatch(/"tenant_id" = \$1/);
    expect(params).toEqual(["dyn-tenant"]);
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
    unsafeMock.mockResolvedValue([]);
  });

  it("returns an empty array when no rows exist", async () => {
    const stepDef = getStep("read.findMany");
    unsafeMock.mockResolvedValueOnce([]);

    const result = await stepDef!.run({ name: "list", table: testTable }, mockCtx);

    expect(result).toEqual([]);
  });

  it("applies the limit when specified", async () => {
    const stepDef = getStep("read.findMany");
    const rows = [{ id: "a" }, { id: "b" }];
    unsafeMock.mockResolvedValueOnce(rows);

    await stepDef!.run({ name: "list", table: testTable, limit: 2 }, mockCtx);

    expect(unsafeMock).toHaveBeenCalledOnce();
    const [sqlText] = unsafeMock.mock.calls[0]!;
    expect(sqlText).toMatch(/LIMIT 2/);
  });
});

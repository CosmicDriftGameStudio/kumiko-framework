import type { SQL } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { getStep } from "../define-step";
import { buildUnsafeProjectionDeleteStep } from "../steps/unsafe-projection-delete";
import type { PipelineCtx } from "../types/step";

const testTable = pgTable("test_projection", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  label: text("label"),
});

const mockDb = { delete: vi.fn() };
const mockDeleteBuilder = { where: vi.fn() };

const mockCtx = {
  db: mockDb,
  event: { type: "test", payload: {} },
  steps: {},
  scope: {},
} as unknown as PipelineCtx;

describe("buildUnsafeProjectionDeleteStep", () => {
  it("returns a StepInstance with kind unsafeProjectionDelete", () => {
    const step = buildUnsafeProjectionDeleteStep({
      table: testTable,
      where: () => undefined as unknown as SQL,
    });
    expect(step.kind).toBe("unsafeProjectionDelete");
    expect(step.args).toMatchObject({ table: testTable });
  });

  it("accepts a static SQL where clause", () => {
    const step = buildUnsafeProjectionDeleteStep({
      table: testTable,
      where: undefined as unknown as SQL,
    });
    expect(step.args).toHaveProperty("table");
  });
});

describe("unsafeProjectionDelete run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.delete.mockReturnValue(mockDeleteBuilder);
  });

  it("calls db.delete().where() with the resolved where clause", async () => {
    const stepDef = getStep("unsafeProjectionDelete");
    expect(stepDef).toBeDefined();

    const whereClause = "fake sql" as unknown as SQL;
    await stepDef!.run({ table: testTable, where: whereClause }, mockCtx);

    expect(mockDb.delete).toHaveBeenCalledOnce();
    expect(mockDeleteBuilder.where).toHaveBeenCalledWith(whereClause);
  });

  it("resolves a function where-clause before calling delete", async () => {
    const stepDef = getStep("unsafeProjectionDelete");

    const whereFn = vi.fn(() => "dynamic where" as unknown as SQL);
    await stepDef!.run({ table: testTable, where: whereFn }, mockCtx);

    expect(whereFn).toHaveBeenCalledWith(mockCtx);
    expect(mockDeleteBuilder.where).toHaveBeenCalledWith("dynamic where");
  });
});

import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { getStep } from "../define-step";
import { buildUnsafeProjectionUpsertStep } from "../steps/unsafe-projection-upsert";
import type { PipelineCtx } from "../types/step";

const testTable = pgTable("test_projection", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  externalId: text("external_id").notNull().unique(),
  label: text("label"),
});

const mockConflictBuilder = { onConflictDoUpdate: vi.fn() };
const mockValuesBuilder = { values: vi.fn(() => mockConflictBuilder) };
const mockDb = { insert: vi.fn(() => mockValuesBuilder) };

const mockCtx = {
  db: mockDb,
  event: { type: "test", payload: {} },
  steps: {},
  scope: {},
} as unknown as PipelineCtx;

describe("buildUnsafeProjectionUpsertStep", () => {
  it("returns a StepInstance with kind unsafeProjectionUpsert", () => {
    const step = buildUnsafeProjectionUpsertStep({
      table: testTable,
      on: ["externalId"],
      row: { tenantId: "t1", externalId: "e1", label: "hello" },
    });
    expect(step.kind).toBe("unsafeProjectionUpsert");
    expect(step.args).toMatchObject({
      table: testTable,
      on: ["externalId"],
    });
  });

  it("accepts a static row resolver", () => {
    const step = buildUnsafeProjectionUpsertStep({
      table: testTable,
      on: ["externalId"],
      row: { tenantId: "t1", externalId: "e1" },
    });
    expect(step.args.row).toEqual({ tenantId: "t1", externalId: "e1" });
  });

  it("accepts a function row resolver", () => {
    const resolver = vi.fn(() => ({ tenantId: "t1", externalId: "e1" }));
    const step = buildUnsafeProjectionUpsertStep({
      table: testTable,
      on: ["externalId"],
      row: resolver,
    });
    expect(typeof step.args.row).toBe("function");
  });

  it("accepts multiple conflict key columns", () => {
    const step = buildUnsafeProjectionUpsertStep({
      table: testTable,
      on: ["tenantId", "externalId"],
      row: { tenantId: "t1", externalId: "e1" },
    });
    expect(step.args.on).toEqual(["tenantId", "externalId"]);
  });
});

describe("unsafeProjectionUpsert run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when a conflict-key column does not exist on the table", async () => {
    const stepDef = getStep("unsafeProjectionUpsert");
    expect(stepDef).toBeDefined();

    await expect(
      stepDef!.run(
        {
          table: testTable,
          on: ["nonExistentColumn"],
          row: { tenantId: "t1" },
        },
        mockCtx,
      ),
    ).rejects.toThrow(/column "nonExistentColumn" not found/);
  });

  it("builds conflict targets from the `on` keys and excludes them from updateSet", async () => {
    const stepDef = getStep("unsafeProjectionUpsert");
    const row = { tenantId: "t1", externalId: "e1", label: "hello" };

    await stepDef!.run({ table: testTable, on: ["externalId"], row }, mockCtx);

    expect(mockDb.insert).toHaveBeenCalledOnce();
    expect(mockConflictBuilder.onConflictDoUpdate).toHaveBeenCalledOnce();

    const conflictArgs = mockConflictBuilder.onConflictDoUpdate.mock.calls[0]![0]!;
    expect(conflictArgs.set).toEqual({ tenantId: "t1", label: "hello" });
  });

  it("calls insert().onConflictDoUpdate with the resolved row and conflict targets", async () => {
    const stepDef = getStep("unsafeProjectionUpsert");

    await stepDef!.run(
      {
        table: testTable,
        on: ["externalId"],
        row: { tenantId: "t1", externalId: "e1", label: "hi" },
      },
      mockCtx,
    );

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockConflictBuilder.onConflictDoUpdate).toHaveBeenCalled();
  });
});

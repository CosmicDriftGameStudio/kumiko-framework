import { beforeEach, describe, expect, it, mock } from "bun:test";
import { table, text, uuid } from "../../db/dialect";
import { getStep } from "../define-step";
import { buildUnsafeProjectionUpsertStep } from "../steps/unsafe-projection-upsert";
import type { PipelineCtx } from "../types/step";

const testTable = table("test_projection", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  externalId: text("external_id").notNull().unique(),
  label: text("label"),
});

// New bun-db path: step uses asRawClient(ctx.db.raw).unsafe(sqlText, params).
// Capture the raw SQL string + params per call instead of the old
// insert/values/onConflictDoUpdate chain.
const unsafeMock = mock(async (_sqlText: string, _params: unknown[]) => []);
const beginMock = mock(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));
const rawDb = { unsafe: unsafeMock, begin: beginMock };
const ctxDb = { raw: rawDb };

const mockCtx = {
  db: ctxDb,
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
    expect((step.args as { row: unknown }).row).toEqual({ tenantId: "t1", externalId: "e1" });
  });

  it("accepts a function row resolver", () => {
    const resolver = mock(() => ({ tenantId: "t1", externalId: "e1" }));
    const step = buildUnsafeProjectionUpsertStep({
      table: testTable,
      on: ["externalId"],
      row: resolver,
    });
    expect(typeof (step.args as { row: unknown }).row).toBe("function");
  });

  it("accepts multiple conflict key columns", () => {
    const step = buildUnsafeProjectionUpsertStep({
      table: testTable,
      on: ["tenantId", "externalId"],
      row: { tenantId: "t1", externalId: "e1" },
    });
    expect((step.args as { on: string[] }).on).toEqual(["tenantId", "externalId"]);
  });
});

describe("unsafeProjectionUpsert run", () => {
  beforeEach(() => {
    mock.clearAllMocks();
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

    expect(unsafeMock).toHaveBeenCalledTimes(1);
    const [sqlText, params] = unsafeMock.mock.calls[0]!;
    expect(sqlText).toMatch(/INSERT INTO "test_projection"/);
    expect(sqlText).toMatch(/ON CONFLICT \("external_id"\) DO UPDATE SET/);
    // SET clause excludes the conflict-key column ("external_id") but
    // includes the other columns (tenant_id, label).
    expect(sqlText).toMatch(/"tenant_id" = \$/);
    expect(sqlText).toMatch(/"label" = \$/);
    expect(sqlText).not.toMatch(/"external_id" = \$\d+,/);
    expect(params).toEqual(["t1", "e1", "hello", "t1", "hello"]);
  });

  it("calls INSERT ... ON CONFLICT DO UPDATE with the resolved row + conflict targets", async () => {
    const stepDef = getStep("unsafeProjectionUpsert");

    await stepDef!.run(
      {
        table: testTable,
        on: ["externalId"],
        row: { tenantId: "t1", externalId: "e1", label: "hi" },
      },
      mockCtx,
    );

    expect(unsafeMock).toHaveBeenCalled();
    const [sqlText] = unsafeMock.mock.calls[0]!;
    expect(sqlText).toMatch(/INSERT INTO "test_projection"/);
    expect(sqlText).toMatch(/ON CONFLICT \("external_id"\) DO UPDATE/);
  });
});

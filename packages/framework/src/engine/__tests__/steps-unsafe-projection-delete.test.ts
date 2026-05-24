import { beforeEach, describe, expect, it, mock } from "bun:test";
import { table, text, uuid } from "../../db/dialect";
import { getStep } from "../define-step";
import { buildUnsafeProjectionDeleteStep } from "../steps/unsafe-projection-delete";
import type { PipelineCtx } from "../types/step";

const testTable = table("test_projection", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  label: text("label"),
});

// bun-db path: step calls deleteMany(ctx.db.raw, table, where) which lands on
// asRawClient(ctx.db.raw).unsafe(sqlText, params).
const unsafeMock = mock(async (_sqlText: string, _params: unknown[]): Promise<unknown[]> => []);
const rawDb = { unsafe: unsafeMock, begin: mock() };
const ctxDb = { raw: rawDb };

const mockCtx = {
  db: ctxDb,
  event: { type: "test", payload: {} },
  steps: {},
  scope: {},
} as unknown as PipelineCtx;

describe("buildUnsafeProjectionDeleteStep", () => {
  it("returns a StepInstance with kind unsafeProjectionDelete", () => {
    const step = buildUnsafeProjectionDeleteStep({
      table: testTable,
      where: () => ({}),
    });
    expect(step.kind).toBe("unsafeProjectionDelete");
    expect(step.args).toMatchObject({ table: testTable });
  });

  it("accepts a static where clause", () => {
    const step = buildUnsafeProjectionDeleteStep({
      table: testTable,
      where: { id: "x" },
    });
    expect(step.args).toHaveProperty("table");
  });
});

describe("unsafeProjectionDelete run", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("issues DELETE ... WHERE ... with the resolved where clause", async () => {
    const stepDef = getStep("unsafeProjectionDelete");
    expect(stepDef).toBeDefined();

    await stepDef!.run({ table: testTable, where: { id: "abc" } }, mockCtx);

    expect(unsafeMock).toHaveBeenCalledOnce();
    const [sqlText, params] = unsafeMock.mock.calls[0]!;
    expect(sqlText).toMatch(/DELETE FROM "test_projection"/);
    expect(sqlText).toMatch(/"id" = \$1/);
    expect(params).toEqual(["abc"]);
  });

  it("resolves a function where-clause before calling delete", async () => {
    const stepDef = getStep("unsafeProjectionDelete");

    const whereFn = mock(() => ({ tenantId: "t1" }));
    await stepDef!.run({ table: testTable, where: whereFn }, mockCtx);

    expect(whereFn).toHaveBeenCalledWith(mockCtx);
    expect(unsafeMock).toHaveBeenCalledOnce();
    const [, params] = unsafeMock.mock.calls[0]!;
    expect(params).toEqual(["t1"]);
  });
});

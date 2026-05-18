import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventStoreExecutor } from "../../db/event-store-executor";
import { getStep } from "../define-step";
import { buildAggregateCreateStep } from "../steps/aggregate-create";
import type { PipelineCtx } from "../types/step";

const mockCreate = vi.fn();
const mockExecutor = { create: mockCreate } as unknown as EventStoreExecutor & {
  create: typeof mockCreate;
};
const mockDb = {};

const mockCtx = {
  db: mockDb,
  event: { type: "test", payload: { label: "test" }, user: { id: "u1" } },
  steps: {},
  scope: {},
} as unknown as PipelineCtx;

describe("buildAggregateCreateStep", () => {
  it("returns a StepInstance with kind aggregate.create", () => {
    const step = buildAggregateCreateStep("widget", {
      executor: mockExecutor,
      data: { label: "hello" },
    });
    expect(step.kind).toBe("aggregate.create");
    expect((step.args as { name: string }).name).toBe("widget");
  });

  it("stores the result key from the name arg", () => {
    const step = buildAggregateCreateStep("myResult", {
      executor: mockExecutor,
      data: { label: "hello" },
    });
    const def = getStep("aggregate.create");
    expect(def?.resultKey?.(step.args as { name: string })).toBe("myResult");
  });
});

describe("aggregate.create run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves data and calls executor.create with user and db", async () => {
    const stepDef = getStep("aggregate.create");
    mockExecutor.create.mockResolvedValue({
      isSuccess: true,
      data: { id: "abc-123", label: "hello" },
    });

    const result = await stepDef!.run(
      { name: "widget", executor: mockExecutor, data: { label: "hello" } },
      mockCtx,
    );

    expect(mockExecutor.create).toHaveBeenCalledWith(
      { label: "hello" },
      mockCtx.event.user,
      mockDb,
    );
    expect(result).toEqual({ id: "abc-123", label: "hello" });
  });

  it("resolves a function data resolver before calling executor.create", async () => {
    const stepDef = getStep("aggregate.create");
    const dataFn = vi.fn((ctx: PipelineCtx) => ({
      label: (ctx.event.payload as { label: string }).label,
    }));
    mockExecutor.create.mockResolvedValue({
      isSuccess: true,
      data: { id: "abc", label: "test" },
    });

    await stepDef!.run({ name: "widget", executor: mockExecutor, data: dataFn }, mockCtx);

    expect(dataFn).toHaveBeenCalledWith(mockCtx);
    expect(mockExecutor.create).toHaveBeenCalledWith({ label: "test" }, mockCtx.event.user, mockDb);
  });

  it("re-throws executor WriteFailure as a KumikoError", async () => {
    const stepDef = getStep("aggregate.create");
    mockExecutor.create.mockResolvedValue({
      isSuccess: false,
      error: { code: "validation_error", message: "label is required" },
    });

    await expect(
      stepDef!.run({ name: "widget", executor: mockExecutor, data: {} }, mockCtx),
    ).rejects.toThrow(/label is required/);
  });
});

import { describe, expect, it, vi } from "vitest";
import { getStep } from "../define-step";
import { buildAggregateUpdateStep } from "../steps/aggregate-update";
import type { PipelineCtx } from "../types/step";

const mockExecutor = { update: vi.fn() };
const mockDb = {};

const mockCtx = {
  db: mockDb,
  event: { type: "test", payload: {}, user: { id: "u1" } },
  steps: {},
  scope: {},
} as unknown as PipelineCtx;

describe("buildAggregateUpdateStep", () => {
  it("returns a StepInstance with kind aggregate.update", () => {
    const step = buildAggregateUpdateStep("widget", {
      executor: mockExecutor,
      id: "abc-123",
      changes: { label: "updated" },
    });
    expect(step.kind).toBe("aggregate.update");
    expect((step.args as { name: string }).name).toBe("widget");
  });

  it("stores the result key from the name arg", () => {
    const step = buildAggregateUpdateStep("myUpdate", {
      executor: mockExecutor,
      id: "abc",
      changes: {},
    });
    const def = getStep("aggregate.update");
    expect(def?.resultKey?.(step.args as { name: string })).toBe("myUpdate");
  });

  it("accepts an optional version resolver", () => {
    const step = buildAggregateUpdateStep("widget", {
      executor: mockExecutor,
      id: "abc",
      changes: {},
      version: () => 1,
    });
    expect(typeof (step.args as { version: unknown }).version).toBe("function");
  });

  it("accepts skipOptimisticLock flag", () => {
    const step = buildAggregateUpdateStep("widget", {
      executor: mockExecutor,
      id: "abc",
      changes: {},
      skipOptimisticLock: true,
    });
    expect((step.args as { skipOptimisticLock: boolean }).skipOptimisticLock).toBe(true);
  });
});

describe("aggregate.update run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves id, changes, version and calls executor.update", async () => {
    const stepDef = getStep("aggregate.update");
    mockExecutor.update.mockResolvedValue({
      isSuccess: true,
      data: { id: "abc", changes: { label: "updated" }, previous: { label: "old" } },
    });

    await stepDef!.run(
      {
        name: "widget",
        executor: mockExecutor,
        id: "abc-123",
        changes: { label: "updated" },
      },
      mockCtx,
    );

    expect(mockExecutor.update).toHaveBeenCalled();
    const [input, user, db] = mockExecutor.update.mock.calls[0]!;
    expect(input).toMatchObject({ id: "abc-123", changes: { label: "updated" } });
    expect(user).toBe(mockCtx.event.user);
    expect(db).toBe(mockDb);
  });

  it("passes skipOptimisticLock when set", async () => {
    const stepDef = getStep("aggregate.update");
    mockExecutor.update.mockResolvedValue({
      isSuccess: true,
      data: { id: "abc", changes: {} },
    });

    await stepDef!.run(
      {
        name: "widget",
        executor: mockExecutor,
        id: "abc",
        changes: {},
        skipOptimisticLock: true,
      },
      mockCtx,
    );

    const [, , , opts] = mockExecutor.update.mock.calls[0]!;
    expect(opts).toEqual({ skipOptimisticLock: true });
  });

  it("re-throws executor WriteFailure as a KumikoError", async () => {
    const stepDef = getStep("aggregate.update");
    mockExecutor.update.mockResolvedValue({
      isSuccess: false,
      error: { code: "not_found", message: "aggregate not found" },
    });

    await expect(
      stepDef!.run(
        { name: "widget", executor: mockExecutor, id: "nonexistent", changes: {} },
        mockCtx,
      ),
    ).rejects.toThrow(/aggregate not found/);
  });
});

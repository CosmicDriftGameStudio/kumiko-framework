import { describe, expect, it, vi } from "vitest";
import { getStep } from "../define-step";
import { buildAggregateAppendEventStep } from "../steps/aggregate-append-event";
import type { PipelineCtx } from "../types/step";

const mockUnsafeAppendEvent = vi.fn();

const mockCtx = {
  unsafeAppendEvent: mockUnsafeAppendEvent,
  event: { type: "test", payload: {} },
  steps: {},
  scope: {},
} as unknown as PipelineCtx;

describe("buildAggregateAppendEventStep", () => {
  it("returns a StepInstance with kind aggregate.appendEvent", () => {
    const step = buildAggregateAppendEventStep({
      aggregateId: "abc-123",
      aggregateType: "widget",
      type: "widget:event:custom",
      payload: { note: "test" },
    });
    expect(step.kind).toBe("aggregate.appendEvent");
  });

  it("accepts optional headers", () => {
    const step = buildAggregateAppendEventStep({
      aggregateId: "abc",
      aggregateType: "widget",
      type: "widget:event:custom",
      payload: {},
      headers: { correlationId: "corr-1" },
    });
    expect((step.args as { headers: Record<string, string> }).headers).toEqual({ correlationId: "corr-1" });
  });
});

describe("aggregate.appendEvent run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls ctx.unsafeAppendEvent with resolved aggregateId and payload", async () => {
    const stepDef = getStep("aggregate.appendEvent");
    expect(stepDef).toBeDefined();

    await stepDef!.run(
      {
        aggregateId: "abc-123",
        aggregateType: "widget",
        type: "widget:event:custom",
        payload: { note: "hello" },
      },
      mockCtx,
    );

    expect(mockUnsafeAppendEvent).toHaveBeenCalledOnce();
    const call = mockUnsafeAppendEvent.mock.calls[0]![0];
    expect(call).toMatchObject({
      aggregateId: "abc-123",
      aggregateType: "widget",
      type: "widget:event:custom",
      payload: { note: "hello" },
    });
  });

  it("resolves function resolvers before calling unsafeAppendEvent", async () => {
    const stepDef = getStep("aggregate.appendEvent");
    const idFn = vi.fn(() => "dynamic-id");
    const payloadFn = vi.fn(() => ({ note: "dynamic" }));
    const headersFn = vi.fn(() => ({ key: "val" }));

    await stepDef!.run(
      {
        aggregateId: idFn,
        aggregateType: "widget",
        type: "widget:event:custom",
        payload: payloadFn,
        headers: headersFn,
      },
      mockCtx,
    );

    expect(idFn).toHaveBeenCalledWith(mockCtx);
    expect(payloadFn).toHaveBeenCalledWith(mockCtx);
    expect(headersFn).toHaveBeenCalledWith(mockCtx);

    expect(mockUnsafeAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateId: "dynamic-id",
        payload: { note: "dynamic" },
        headers: { key: "val" },
      }),
    );
  });

  it("omits headers from the event when headers resolver is undefined", async () => {
    const stepDef = getStep("aggregate.appendEvent");

    await stepDef!.run(
      {
        aggregateId: "abc",
        aggregateType: "widget",
        type: "widget:event:plain",
        payload: { x: 1 },
      },
      mockCtx,
    );

    const call = mockUnsafeAppendEvent.mock.calls[0]![0];
    expect(call.headers).toBeUndefined();
  });
});

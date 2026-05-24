import { beforeEach, describe, expect, it } from "bun:test";
import { getStep } from "../define-step";
import {
  SUSPEND_SENTINEL,
  WORKFLOW_AGGREGATE_TYPE,
  WORKFLOW_WAITING_FOR_EVENT_TYPE,
  WORKFLOW_WAITING_TYPE,
} from "../steps/_step-dispatch-constants";
import { buildRetryStep, calculateBackoff } from "../steps/retry";
import { buildWaitStep } from "../steps/wait";
import { buildWaitForEventStep } from "../steps/wait-for-event";
import type { PipelineCtx } from "../types/step";

const mockUnsafeAppendEvent = mock();

const workflowCtx = {
  unsafeAppendEvent: mockUnsafeAppendEvent,
  event: { type: "user.signed-up", payload: { email: "test@example.com" } },
  steps: {},
  scope: {},
  workflow: {
    runId: "wr_abc123",
    workflowName: "test-workflow",
    stepIndex: 0,
  },
} as unknown as PipelineCtx;

const nonWorkflowCtx = {
  unsafeAppendEvent: mockUnsafeAppendEvent,
  event: { type: "test", payload: { url: "https://hooks.example/test" } },
  steps: {},
  scope: {},
} as unknown as PipelineCtx;

describe("buildWaitStep", () => {
  it("returns a StepInstance with kind workflow.wait", () => {
    const step = buildWaitStep({ for: "PT1H" });
    expect(step.kind).toBe("workflow.wait");
  });

  it("accepts an ISO-8601 duration string", () => {
    const step = buildWaitStep({ for: "P1D" });
    expect((step.args as { for: string }).for).toBe("P1D");
  });
});

describe("workflow.wait run", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("throws when used outside defineWorkflow (no ctx.workflow)", async () => {
    const stepDef = getStep("workflow.wait");
    expect(stepDef).toBeDefined();
    await expect(stepDef!.run({ for: "PT1H" }, nonWorkflowCtx)).rejects.toThrow(
      /only allowed inside defineWorkflow/,
    );
  });

  it("writes a workflow.step.waiting event and returns SUSPEND_SENTINEL", async () => {
    const stepDef = getStep("workflow.wait");
    expect(stepDef).toBeDefined();

    const result = await stepDef!.run({ for: "PT1H" }, workflowCtx);

    expect(result).toBe(SUSPEND_SENTINEL);
    expect(mockUnsafeAppendEvent).toHaveBeenCalledOnce();
    const eventArg = mockUnsafeAppendEvent.mock.calls[0]![0];
    expect(eventArg.aggregateType).toBe(WORKFLOW_AGGREGATE_TYPE);
    expect(eventArg.type).toBe(WORKFLOW_WAITING_TYPE);
    expect(eventArg.aggregateId).toBe("wr_abc123");
    expect(eventArg.payload.stepIndex).toBe(0);
    expect(typeof eventArg.payload.wakeAt).toBe("string");
    expect(eventArg.payload.workflowName).toBe("test-workflow");
  });

  it("accepts an absolute ISO timestamp as the `for` value", async () => {
    const stepDef = getStep("workflow.wait");
    expect(stepDef).toBeDefined();

    const future = new Date(Date.now() + 86400000).toISOString();
    const result = await stepDef!.run({ for: future }, workflowCtx);

    expect(result).toBe(SUSPEND_SENTINEL);
    const eventArg = mockUnsafeAppendEvent.mock.calls[0]![0];
    expect(eventArg.payload.wakeAt).toBe(future);
  });
});

describe("buildWaitForEventStep", () => {
  it("returns a StepInstance with kind workflow.waitForEvent", () => {
    const step = buildWaitForEventStep({
      event: "user.confirmed-email",
      timeout: "P7D",
    });
    expect(step.kind).toBe("workflow.waitForEvent");
  });

  it("accepts an optional match resolver", () => {
    const step = buildWaitForEventStep({
      event: "user.confirmed-email",
      match: (payload: unknown) => (payload as { email: string }).email === "test@test.com",
      timeout: "P7D",
    });
    expect(step.kind).toBe("workflow.waitForEvent");
  });
});

describe("workflow.waitForEvent run", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("throws when used outside defineWorkflow", async () => {
    const stepDef = getStep("workflow.waitForEvent");
    expect(stepDef).toBeDefined();
    await expect(
      stepDef!.run({ event: "user.confirmed-email", timeout: "P7D" }, nonWorkflowCtx),
    ).rejects.toThrow(/only allowed inside defineWorkflow/);
  });

  it("writes a workflow.step.waiting-for-event event and returns SUSPEND_SENTINEL", async () => {
    const stepDef = getStep("workflow.waitForEvent");
    expect(stepDef).toBeDefined();

    const result = await stepDef!.run(
      { event: "user.confirmed-email", timeout: "P7D" },
      workflowCtx,
    );

    expect(result).toBe(SUSPEND_SENTINEL);
    expect(mockUnsafeAppendEvent).toHaveBeenCalledOnce();
    const eventArg = mockUnsafeAppendEvent.mock.calls[0]![0];
    expect(eventArg.aggregateType).toBe(WORKFLOW_AGGREGATE_TYPE);
    expect(eventArg.type).toBe(WORKFLOW_WAITING_FOR_EVENT_TYPE);
    expect(eventArg.aggregateId).toBe("wr_abc123");
    expect(eventArg.payload.eventType).toBe("user.confirmed-email");
    expect(typeof eventArg.payload.timeoutAt).toBe("string");
    expect(eventArg.payload.workflowName).toBe("test-workflow");
  });
});

describe("buildRetryStep", () => {
  it("returns a StepInstance with kind workflow.retry", () => {
    const step = buildRetryStep({
      times: 3,
      backoff: "exponential",
      do: [],
    });
    expect(step.kind).toBe("workflow.retry");
  });

  it("requires times and backoff", () => {
    const step = buildRetryStep({
      times: 5,
      backoff: "linear",
      do: [],
    });
    expect((step.args as { times: number }).times).toBe(5);
  });
});

describe("workflow.retry run", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("throws when used outside defineWorkflow", async () => {
    const stepDef = getStep("workflow.retry");
    expect(stepDef).toBeDefined();
    await expect(
      stepDef!.run({ times: 3, backoff: "exponential", do: [] }, nonWorkflowCtx),
    ).rejects.toThrow(/only allowed inside defineWorkflow/);
  });

  it("executes the do sub-pipeline and returns undefined on success", async () => {
    const stepDef = getStep("workflow.retry");
    expect(stepDef).toBeDefined();

    const result = await stepDef!.run({ times: 3, backoff: "exponential", do: [] }, workflowCtx);

    expect(result).toBeUndefined();
  });
});

describe("calculateBackoff", () => {
  it("returns baseMs * attempt for linear strategy", () => {
    expect(calculateBackoff(1, "linear")).toBe(10_000);
    expect(calculateBackoff(3, "linear")).toBe(30_000);
  });

  it("returns baseMs * 2^(attempt-1) for exponential strategy", () => {
    expect(calculateBackoff(1, "exponential")).toBe(10_000);
    expect(calculateBackoff(2, "exponential")).toBe(20_000);
    expect(calculateBackoff(3, "exponential")).toBe(40_000);
    expect(calculateBackoff(4, "exponential")).toBe(80_000);
  });
});

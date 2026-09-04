import { beforeEach, describe, expect, it, mock } from "bun:test";
import { getStep } from "../define-step";
import { evaluateEventMatch } from "../steps/_event-match";
import {
  SUSPEND_SENTINEL,
  WORKFLOW_AGGREGATE_TYPE,
  WORKFLOW_WAITING_FOR_EVENT_TYPE,
  WORKFLOW_WAITING_TYPE,
} from "../steps/_step-dispatch-constants";
import { buildRetryStep, calculateBackoff } from "../steps/retry";
import { buildWaitStep } from "../steps/wait";
import { buildWaitForEventStep } from "../steps/wait-for-event";
import type { AwaitedEventType, EventMatch, PipelineCtx } from "../types/step";

// Test-only helper for the low-level step-builder unit tests below, which
// call buildWaitForEventStep directly instead of going through a
// defineWorkflow `awaits` declaration (the only legitimate branding route).
const asAwaited = (event: string): AwaitedEventType => event as AwaitedEventType;

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
    mock.clearAllMocks();
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
    expect(mockUnsafeAppendEvent).toHaveBeenCalledTimes(1);
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
      event: asAwaited("user.confirmed-email"),
      timeout: "P7D",
    });
    expect(step.kind).toBe("workflow.waitForEvent");
  });

  it("accepts an optional match AST", () => {
    const match: EventMatch = {
      version: 1,
      expr: { kind: "atom", path: ["email"], op: { kind: "eq", value: "test@test.com" } },
    };
    const step = buildWaitForEventStep({
      event: asAwaited("user.confirmed-email"),
      match,
      timeout: "P7D",
    });
    expect(step.kind).toBe("workflow.waitForEvent");
  });

  it("@ts-expect-error: event must come from an awaits declaration, not a raw string", () => {
    // @ts-expect-error — a raw string is not an AwaitedEventType; only
    // defineWorkflow's `awaits` map can produce one (D4, workflow-resume-loop.md).
    const step = buildWaitForEventStep({ event: "user.confirmed-email", timeout: "P7D" });
    expect(step.kind).toBe("workflow.waitForEvent");
  });
});

describe("workflow.waitForEvent run", () => {
  beforeEach(() => {
    mock.clearAllMocks();
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
    expect(mockUnsafeAppendEvent).toHaveBeenCalledTimes(1);
    const eventArg = mockUnsafeAppendEvent.mock.calls[0]![0];
    expect(eventArg.aggregateType).toBe(WORKFLOW_AGGREGATE_TYPE);
    expect(eventArg.type).toBe(WORKFLOW_WAITING_FOR_EVENT_TYPE);
    expect(eventArg.aggregateId).toBe("wr_abc123");
    expect(eventArg.payload.eventType).toBe("user.confirmed-email");
    expect(typeof eventArg.payload.timeoutAt).toBe("string");
    expect(eventArg.payload.workflowName).toBe("test-workflow");
  });

  it("omits the match key from the payload when no match is given", async () => {
    const stepDef = getStep("workflow.waitForEvent");
    expect(stepDef).toBeDefined();

    await stepDef!.run({ event: "user.confirmed-email", timeout: "P7D" }, workflowCtx);

    const eventArg = mockUnsafeAppendEvent.mock.calls[0]![0];
    expect("match" in eventArg.payload).toBe(false);
  });

  it("resolves a match resolver to a serializable AST that round-trips through JSON and evaluates against real payloads", async () => {
    const stepDef = getStep("workflow.waitForEvent");
    expect(stepDef).toBeDefined();

    const result = await stepDef!.run(
      {
        event: "user.confirmed-email",
        match: (ctx: PipelineCtx): EventMatch => ({
          version: 1,
          expr: {
            kind: "atom",
            path: ["email"],
            op: { kind: "eq", value: (ctx.event.payload as { email: string }).email },
          },
        }),
        timeout: "P7D",
      },
      workflowCtx,
    );

    expect(result).toBe(SUSPEND_SENTINEL);
    const eventArg = mockUnsafeAppendEvent.mock.calls[0]![0];
    const persistedMatch = eventArg.payload.match;

    // Proves the persisted value is the resolved literal AST, not the resolver function.
    expect(persistedMatch).toEqual({
      version: 1,
      expr: {
        kind: "atom",
        path: ["email"],
        op: { kind: "eq", value: "test@example.com" },
      },
    });

    // Proves serializability — the whole point of the AST switch — by round-tripping
    // through JSON before feeding it to the evaluator, same as a rehydrated event would.
    const roundTripped = JSON.parse(JSON.stringify(persistedMatch));
    expect(evaluateEventMatch(roundTripped, { email: "test@example.com" })).toBe(true);
    expect(evaluateEventMatch(roundTripped, { email: "someone-else@example.com" })).toBe(false);
  });
});

describe("evaluateEventMatch", () => {
  it("throws on an unsupported version", () => {
    const stale = JSON.parse(
      JSON.stringify({
        version: 2,
        expr: { kind: "atom", path: ["x"], op: { kind: "eq", value: 1 } },
      }),
    );
    expect(() => evaluateEventMatch(stale, {})).toThrow(/version/i);
  });

  it("throws on an unrecognized expr kind", () => {
    const bad = JSON.parse(JSON.stringify({ version: 1, expr: { kind: "not-a-kind" } }));
    expect(() => evaluateEventMatch(bad, {})).toThrow(/kind/i);
  });

  it("throws on an unrecognized op kind", () => {
    const bad = JSON.parse(
      JSON.stringify({
        version: 1,
        expr: { kind: "atom", path: ["x"], op: { kind: "not-an-op" } },
      }),
    );
    expect(() => evaluateEventMatch(bad, {})).toThrow(/kind/i);
  });

  it("and with empty nodes is true, or with empty nodes is false", () => {
    expect(evaluateEventMatch({ version: 1, expr: { kind: "and", nodes: [] } }, {})).toBe(true);
    expect(evaluateEventMatch({ version: 1, expr: { kind: "or", nodes: [] } }, {})).toBe(false);
  });

  it("combines atoms with and/or", () => {
    const match: EventMatch = {
      version: 1,
      expr: {
        kind: "and",
        nodes: [
          { kind: "atom", path: ["status"], op: { kind: "eq", value: "confirmed" } },
          { kind: "atom", path: ["tier"], op: { kind: "in", values: ["gold", "platinum"] } },
        ],
      },
    };
    expect(evaluateEventMatch(match, { status: "confirmed", tier: "gold" })).toBe(true);
    expect(evaluateEventMatch(match, { status: "confirmed", tier: "silver" })).toBe(false);
  });

  it("ne matches when the resolved value differs", () => {
    const match: EventMatch = {
      version: 1,
      expr: { kind: "atom", path: ["status"], op: { kind: "ne", value: "cancelled" } },
    };
    expect(evaluateEventMatch(match, { status: "confirmed" })).toBe(true);
    expect(evaluateEventMatch(match, { status: "cancelled" })).toBe(false);
  });

  it("compares numbers with gte", () => {
    const match: EventMatch = {
      version: 1,
      expr: { kind: "atom", path: ["amount"], op: { kind: "gte", value: 100 } },
    };
    expect(evaluateEventMatch(match, { amount: 150 })).toBe(true);
    expect(evaluateEventMatch(match, { amount: 50 })).toBe(false);
  });

  it("does not match a comparison op when the payload value's type differs from the operand", () => {
    const match: EventMatch = {
      version: 1,
      expr: { kind: "atom", path: ["amount"], op: { kind: "gt", value: 100 } },
    };
    expect(evaluateEventMatch(match, { amount: "150" })).toBe(false);
  });

  it("resolves nested paths and treats a path running into a non-object as unmatched", () => {
    const match: EventMatch = {
      version: 1,
      expr: {
        kind: "atom",
        path: ["user", "email"],
        op: { kind: "eq", value: "a@b.com" },
      },
    };
    expect(evaluateEventMatch(match, { user: { email: "a@b.com" } })).toBe(true);
    expect(evaluateEventMatch(match, { user: "not-an-object" })).toBe(false);
    expect(evaluateEventMatch(match, {})).toBe(false);
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
    mock.clearAllMocks();
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

import { beforeEach, describe, expect, it, mock } from "bun:test";
import { getStep } from "../define-step";
import {
  STEP_DISPATCH_AGGREGATE_TYPE,
  STEP_DISPATCH_REQUESTED_TYPE,
} from "../steps/_step-dispatch-constants";
import { buildMailSendStep } from "../steps/mail-send";
import type { PipelineCtx } from "../types/step";

const mockUnsafeAppendEvent = mock();

const mockCtx = {
  unsafeAppendEvent: mockUnsafeAppendEvent,
  event: { type: "test", payload: {} },
  steps: {},
  scope: {},
} as unknown as PipelineCtx;

describe("buildMailSendStep", () => {
  it("returns a StepInstance with kind mail.send", () => {
    const step = buildMailSendStep({
      to: "user@example.com",
      subject: "Hello",
      body: "World",
      mode: "deferred",
    });
    expect(step.kind).toBe("mail.send");
  });

  it("requires mode to be deferred", () => {
    const step = buildMailSendStep({
      to: "user@example.com",
      subject: "Hello",
      body: "World",
      mode: "deferred",
    });
    expect((step.args as { mode: string }).mode).toBe("deferred");
  });

  it("accepts an optional from address", () => {
    const step = buildMailSendStep({
      to: "user@example.com",
      subject: "Hello",
      body: "World",
      from: "noreply@example.com",
      mode: "deferred",
    });
    expect((step.args as { from: string }).from).toBe("noreply@example.com");
  });

  it("accepts string array for to", () => {
    const step = buildMailSendStep({
      to: ["a@example.com", "b@example.com"],
      subject: "Hello",
      body: "World",
      mode: "deferred",
    });
    expect((step.args as { to: unknown }).to).toEqual(["a@example.com", "b@example.com"]);
  });
});

describe("mail.send run", () => {
  beforeEach(() => {
    mock.clearAllMocks();
  });

  it("appends a step.dispatch-requested system event with the mail spec", async () => {
    const stepDef = getStep("mail.send");
    expect(stepDef).toBeDefined();

    await stepDef!.run(
      {
        to: "user@example.com",
        subject: "Test",
        body: "Body text",
        mode: "deferred",
      },
      mockCtx,
    );

    expect(mockUnsafeAppendEvent).toHaveBeenCalledTimes(1);
    const eventArg = mockUnsafeAppendEvent.mock.calls[0]![0];

    expect(eventArg.aggregateType).toBe(STEP_DISPATCH_AGGREGATE_TYPE);
    expect(eventArg.type).toBe(STEP_DISPATCH_REQUESTED_TYPE);
    expect(eventArg.payload.stepKind).toBe("mail.send");
    expect(eventArg.payload.spec).toMatchObject({
      to: "user@example.com",
      subject: "Test",
      body: "Body text",
    });
  });

  it("resolves function-based resolvers", async () => {
    const stepDef = getStep("mail.send");
    const toFn = mock(() => "resolved@example.com");
    const subjectFn = mock(() => "Resolved Subject");
    const bodyFn = mock(() => "Resolved Body");

    await stepDef!.run({ to: toFn, subject: subjectFn, body: bodyFn, mode: "deferred" }, mockCtx);

    expect(toFn).toHaveBeenCalledWith(mockCtx);
    expect(subjectFn).toHaveBeenCalledWith(mockCtx);
    expect(bodyFn).toHaveBeenCalledWith(mockCtx);
  });

  it("includes from when provided", async () => {
    const stepDef = getStep("mail.send");

    await stepDef!.run(
      {
        to: "user@example.com",
        subject: "Hi",
        body: "Message",
        from: "system@example.com",
        mode: "deferred",
      },
      mockCtx,
    );

    const eventArg = mockUnsafeAppendEvent.mock.calls[0]![0];
    expect(eventArg.payload.spec.from).toBe("system@example.com");
  });

  it("omits from from the spec when not provided", async () => {
    const stepDef = getStep("mail.send");

    await stepDef!.run(
      { to: "user@example.com", subject: "Hi", body: "Message", mode: "deferred" },
      mockCtx,
    );

    const eventArg = mockUnsafeAppendEvent.mock.calls[0]![0];
    expect(eventArg.payload.spec.from).toBeUndefined();
  });
});

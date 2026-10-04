import { beforeEach, describe, expect, it, mock } from "bun:test";
import { getStep } from "../define-step.js";
import {
  STEP_DISPATCH_AGGREGATE_TYPE,
  STEP_DISPATCH_REQUESTED_TYPE,
} from "../steps/_step-dispatch-constants.js";
import { buildWebhookSendStep } from "../steps/webhook-send.js";
import type { PipelineCtx } from "../types/step.js";

const mockUnsafeAppendEvent = mock();

const mockCtx = {
  unsafeAppendEvent: mockUnsafeAppendEvent,
  event: { type: "test", payload: { url: "https://hooks.example/test" } },
  steps: {},
  scope: {},
} as unknown as PipelineCtx;

describe("buildWebhookSendStep", () => {
  it("returns a StepInstance with kind webhook.send", () => {
    const step = buildWebhookSendStep({
      url: "https://hooks.example/test",
      mode: "deferred",
    });
    expect(step.kind).toBe("webhook.send");
  });

  it("requires mode to be deferred", () => {
    const step = buildWebhookSendStep({
      url: "https://hooks.example/test",
      mode: "deferred",
    });
    expect((step.args as { mode: string }).mode).toBe("deferred");
  });

  it("accepts optional method, headers, body, auth", () => {
    const step = buildWebhookSendStep({
      url: "https://hooks.example/test",
      method: "PUT",
      headers: { "X-Custom": "val" },
      body: { event: "test" },
      auth: { kind: "bearer", secret: "MY_SECRET" },
      mode: "deferred",
    });
    expect((step.args as { method: string }).method).toBe("PUT");
  });
});

describe("webhook.send run", () => {
  beforeEach(() => {
    mock.clearAllMocks();
  });

  it("appends a step.dispatch-requested system event with the webhook spec", async () => {
    const stepDef = getStep("webhook.send");
    expect(stepDef).toBeDefined();

    await stepDef!.run(
      {
        url: "https://hooks.example/test",
        mode: "deferred",
        method: "POST",
        body: { event: "incident-opened", id: "abc" },
      },
      mockCtx,
    );

    expect(mockUnsafeAppendEvent).toHaveBeenCalledTimes(1);
    const eventArg = mockUnsafeAppendEvent.mock.calls[0]![0];

    expect(eventArg.aggregateType).toBe(STEP_DISPATCH_AGGREGATE_TYPE);
    expect(eventArg.type).toBe(STEP_DISPATCH_REQUESTED_TYPE);
    expect(eventArg.payload.stepKind).toBe("webhook.send");
    expect(eventArg.payload.url).toBe("https://hooks.example/test");
    expect(JSON.parse(eventArg.payload.bodyJson)).toEqual({ event: "incident-opened", id: "abc" });
    expect(eventArg.payload.headersJson).toBe("{}");
  });

  it("resolves function-based url and body resolvers", async () => {
    const stepDef = getStep("webhook.send");
    const urlFn = mock(() => "https://hooks.example/dynamic");
    const bodyFn = mock(() => ({ key: "value" }));

    await stepDef!.run(
      {
        url: urlFn,
        mode: "deferred",
        body: bodyFn,
      },
      mockCtx,
    );

    expect(urlFn).toHaveBeenCalledWith(mockCtx);
    expect(bodyFn).toHaveBeenCalledWith(mockCtx);
    expect(mockUnsafeAppendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          url: "https://hooks.example/dynamic",
          bodyJson: JSON.stringify({ key: "value" }),
        }),
      }),
    );
  });

  it("defaults method to POST when not specified", async () => {
    const stepDef = getStep("webhook.send");

    await stepDef!.run({ url: "https://hooks.example/test", mode: "deferred" }, mockCtx);

    const eventArg = mockUnsafeAppendEvent.mock.calls[0]![0];
    expect(eventArg.payload.method).toBe("POST");
  });

  it("writes no retry field into the payload", async () => {
    const stepDef = getStep("webhook.send");

    await stepDef!.run({ url: "https://hooks.example/test", mode: "deferred" }, mockCtx);

    const eventArg = mockUnsafeAppendEvent.mock.calls[0]![0];
    expect(eventArg.payload).not.toHaveProperty("retry");
  });

  it("omits bodyJson when no body is given", async () => {
    const stepDef = getStep("webhook.send");

    await stepDef!.run({ url: "https://hooks.example/test", mode: "deferred" }, mockCtx);

    const eventArg = mockUnsafeAppendEvent.mock.calls[0]![0];
    expect("bodyJson" in eventArg.payload).toBe(false);
  });

  it("passes auth config through when provided", async () => {
    const stepDef = getStep("webhook.send");
    const auth = { kind: "bearer" as const, secret: "WEBHOOK_TOKEN" };

    await stepDef!.run({ url: "https://hooks.example/secured", mode: "deferred", auth }, mockCtx);

    const eventArg = mockUnsafeAppendEvent.mock.calls[0]![0];
    expect(eventArg.payload.auth).toEqual(auth);
  });
});
